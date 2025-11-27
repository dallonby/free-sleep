import { watch, FSWatcher } from 'fs';
import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../logger.js';
import { Version } from '../routes/deviceStatus/deviceStatusSchema.js';

const execAsync = promisify(exec);

// Device label file paths (Pod 3 uses /deviceinfo/, Pod 4+ uses /persistent/deviceinfo/)
const DEVICE_LABEL_PATHS = [
  '/persistent/deviceinfo/device-label',
  '/deviceinfo/device-label',
];

class DeviceLabelWatcher {
  private watcher: FSWatcher | null = null;
  private deviceLabelPath: string | null = null;
  private isProcessing = false;

  /**
   * Start the device label watcher.
   * Only activates for Pod 3 hub with Pod 4+ cover.
   * @param coverVersion - The cover version detected from franken
   */
  async start(coverVersion: Version): Promise<void> {
    // Only enable for Pod 4 or Pod 5 covers
    const isPod4PlusCover = coverVersion === Version.Pod4 || coverVersion === Version.Pod5;
    if (!isPod4PlusCover) {
      logger.info(`Device label watcher not needed for cover version: ${coverVersion}`);
      return;
    }

    // Find which path exists
    for (const path of DEVICE_LABEL_PATHS) {
      const exists = await access(path, constants.F_OK)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        this.deviceLabelPath = path;
        break;
      }
    }

    if (!this.deviceLabelPath) {
      logger.info('Device label file not found, skipping watcher');
      return;
    }

    // Check if this is a Pod 3 hub (label starts with F in 3rd group)
    const label = await readFile(this.deviceLabelPath, 'utf-8');
    const parts = label.trim().split('-');
    const hwRev = parts[2] || '';

    // If already G or higher, no need to watch (unless Pod resets it)
    if (!hwRev.startsWith('F')) {
      logger.info(`Device label watcher: hub already at ${hwRev}, starting watch for resets`);
    } else {
      logger.info(`Starting device label watcher for Pod 3 hub (${hwRev}) with ${coverVersion} cover`);
    }

    // Check and fix on startup
    await this.checkAndFixDeviceLabel();

    // Watch for changes (in case Pod resets the label)
    this.watcher = watch(this.deviceLabelPath, async (eventType) => {
      if (eventType === 'change' && !this.isProcessing) {
        logger.debug('Device label file changed, checking...');
        await this.checkAndFixDeviceLabel();
      }
    });

    this.watcher.on('error', (error) => {
      logger.error('Device label watcher error:', error);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Device label watcher stopped');
    }
  }

  private async checkAndFixDeviceLabel(): Promise<void> {
    if (!this.deviceLabelPath || this.isProcessing) return;

    this.isProcessing = true;
    try {
      const label = await readFile(this.deviceLabelPath, 'utf-8');
      const trimmedLabel = label.trim();
      const parts = trimmedLabel.split('-');

      if (parts.length < 3) {
        logger.warn(`Invalid device label format: ${trimmedLabel}`);
        return;
      }

      const hwRev = parts[2];

      // Check if 3rd group starts with 'F' (Pod 3 hub)
      // We want to change it to 'G' to make it behave like Pod 4
      if (hwRev.startsWith('F')) {
        const newHwRev = 'G' + hwRev.slice(1);
        parts[2] = newHwRev;
        const newLabel = parts.join('-');

        logger.info(`Updating device label from ${trimmedLabel} to ${newLabel}`);
        await writeFile(this.deviceLabelPath, newLabel + '\n');

        // Restart the frank service to pick up the new label
        await this.restartFrankService();
      } else {
        logger.debug(`Device label OK: ${trimmedLabel} (hw rev: ${hwRev})`);
      }
    } catch (error) {
      logger.error('Error checking device label:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async restartFrankService(): Promise<void> {
    try {
      logger.info('Restarting frank service...');
      await execAsync('sudo /bin/systemctl restart frank');
      logger.info('Frank service restarted successfully');
    } catch (error) {
      logger.error('Failed to restart frank service:', error);
    }
  }
}

// Singleton instance
export const deviceLabelWatcher = new DeviceLabelWatcher();
