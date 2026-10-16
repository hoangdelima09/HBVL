-- Authors can edit and delete their own comments; every earlier version stays readable by everyone.
ALTER TABLE "comments"
  ADD COLUMN "editedAt" TIMESTAMPTZ(6),
  ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

CREATE TABLE "comment_revisions" (
    "id" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "writtenAt" TIMESTAMPTZ(6) NOT NULL,
    "replacedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "comment_revisions_commentId_replacedAt_idx" ON "comment_revisions"("commentId", "replacedAt");
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
