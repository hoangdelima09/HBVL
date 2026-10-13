-- Short e-mailed codes (6 digits) next to the long link token. Only an HMAC of the code is stored; `attempts` caps guessing per token.
ALTER TABLE "auth_tokens" ADD COLUMN "codeHash" CHAR(64), ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
