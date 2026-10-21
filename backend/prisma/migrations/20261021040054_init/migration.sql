-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AUTHOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('ROYALTY_PAYMENTS', 'ISBN_METADATA', 'PRINTING_QUALITY', 'DISTRIBUTION_AVAILABILITY', 'BOOK_STATUS_PRODUCTION', 'GENERAL_INQUIRY');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('AUTHOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "DraftSource" AS ENUM ('AI', 'FALLBACK');

-- CreateEnum
CREATE TYPE "AiCallKind" AS ENUM ('CLASSIFY', 'DRAFT');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'TIMEOUT', 'RATE_LIMITED', 'INVALID_OUTPUT', 'REFUSED', 'CIRCUIT_OPEN', 'DISABLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "joinedDate" DATE,
    "bankLinked" BOOLEAN,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "publicationDate" DATE,
    "status" TEXT NOT NULL,
    "mrp" INTEGER,
    "authorRoyaltyPerCopy" INTEGER,
    "totalCopiesSold" INTEGER NOT NULL DEFAULT 0,
    "totalRoyaltyEarned" INTEGER NOT NULL DEFAULT 0,
    "royaltyPaid" INTEGER NOT NULL DEFAULT 0,
    "royaltyPending" INTEGER NOT NULL DEFAULT 0,
    "lastRoyaltyPayoutDate" DATE,
    "printPartner" TEXT,
    "availableOn" TEXT[],

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "authorId" TEXT NOT NULL,
    "bookId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "category" "Category" NOT NULL,
    "priority" "Priority" NOT NULL,
    "categoryOverridden" BOOLEAN NOT NULL DEFAULT false,
    "priorityOverridden" BOOLEAN NOT NULL DEFAULT false,
    "aiStatus" "AiStatus" NOT NULL DEFAULT 'PENDING',
    "aiCategory" "Category",
    "aiPriority" "Priority",
    "aiReasoning" TEXT,
    "aiError" TEXT,
    "aiClassifiedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "draftBody" TEXT,
    "draftSource" "DraftSource",
    "draftGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "kind" "AiCallKind" NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "estCost" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Author_userId_key" ON "Author"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Book_isbn_key" ON "Book"("isbn");

-- CreateIndex
CREATE INDEX "Book_authorId_idx" ON "Book"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");

-- CreateIndex
CREATE INDEX "Ticket_isOpen_priority_createdAt_idx" ON "Ticket"("isOpen", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_authorId_createdAt_idx" ON "Ticket"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");

-- CreateIndex
CREATE INDEX "Ticket_category_idx" ON "Ticket"("category");

-- CreateIndex
CREATE INDEX "Ticket_aiStatus_idx" ON "Ticket"("aiStatus");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalNote_ticketId_createdAt_idx" ON "InternalNote"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_ticketId_idx" ON "AiCall"("ticketId");

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- CreateIndex
CREATE INDEX "AiCall_kind_status_idx" ON "AiCall"("kind", "status");

-- AddForeignKey
ALTER TABLE "Author" ADD CONSTRAINT "Author_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
