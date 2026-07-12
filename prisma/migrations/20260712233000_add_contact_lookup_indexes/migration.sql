-- Accelerate the active-contact lookups used by POST /identify.
CREATE INDEX "Contact_email_deletedAt_idx" ON "Contact"("email", "deletedAt");
CREATE INDEX "Contact_phoneNumber_deletedAt_idx" ON "Contact"("phoneNumber", "deletedAt");
CREATE INDEX "Contact_linkedId_deletedAt_idx" ON "Contact"("linkedId", "deletedAt");
