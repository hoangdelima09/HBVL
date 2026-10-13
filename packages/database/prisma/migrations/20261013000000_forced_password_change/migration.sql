-- Accounts whose password an administrator reset to the default must choose a new one before anything else works.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
