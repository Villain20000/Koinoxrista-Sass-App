-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "voteId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "proxyUnitId" TEXT,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgendaItem_voteId_position_key" ON "AgendaItem"("voteId", "position");

-- CreateIndex
CREATE INDEX "AgendaItem_buildingId_idx" ON "AgendaItem"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_voteId_unitId_key" ON "Attendance"("voteId", "unitId");

-- CreateIndex
CREATE INDEX "Attendance_buildingId_idx" ON "Attendance"("buildingId");

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
