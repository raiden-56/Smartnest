-- DropIndex
DROP INDEX "DeviceCapability_deviceId_type_key";

-- CreateIndex
CREATE INDEX "DeviceCapability_deviceId_idx" ON "DeviceCapability"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceCapability_type_idx" ON "DeviceCapability"("type");
