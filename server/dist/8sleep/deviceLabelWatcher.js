
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="e328ad25-eb3b-5865-9171-d30465b7ad81")}catch(e){}}();
import { watch } from 'fs';
import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../logger.js';
const execAsync = promisify(exec);
// Device label file paths (Pod 3 uses /deviceinfo/, Pod 4+ uses /persistent/deviceinfo/)
const DEVICE_LABEL_PATHS = [
    '/persistent/deviceinfo/device-label',
    '/deviceinfo/device-label',
];
class DeviceLabelWatcher {
    watcher = null;
    deviceLabelPath = null;
    isProcessing = false;
    async start() {
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
        logger.info(`Starting device label watcher for ${this.deviceLabelPath}`);
        // Check and fix on startup
        await this.checkAndFixDeviceLabel();
        // Watch for changes
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
    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            logger.info('Device label watcher stopped');
        }
    }
    async checkAndFixDeviceLabel() {
        if (!this.deviceLabelPath || this.isProcessing)
            return;
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
            }
            else {
                logger.debug(`Device label OK: ${trimmedLabel} (hw rev: ${hwRev})`);
            }
        }
        catch (error) {
            logger.error('Error checking device label:', error);
        }
        finally {
            this.isProcessing = false;
        }
    }
    async restartFrankService() {
        try {
            logger.info('Restarting frank service...');
            await execAsync('systemctl restart frank');
            logger.info('Frank service restarted successfully');
        }
        catch (error) {
            logger.error('Failed to restart frank service:', error);
        }
    }
}
// Singleton instance
export const deviceLabelWatcher = new DeviceLabelWatcher();
//# sourceMappingURL=deviceLabelWatcher.js.map
//# debugId=e328ad25-eb3b-5865-9171-d30465b7ad81
