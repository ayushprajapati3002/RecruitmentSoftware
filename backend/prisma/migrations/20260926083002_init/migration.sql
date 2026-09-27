-- CreateTable
CREATE TABLE "candidates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "phone_normalized" VARCHAR(20),
    "vacancy" VARCHAR(200) NOT NULL,
    "resume_url" TEXT,
    "location" VARCHAR(100),
    "notes" TEXT,
    "current_stage" VARCHAR(20) NOT NULL DEFAULT 'Applied',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_history" (
    "id" SERIAL NOT NULL,
    "candidate_id" INTEGER NOT NULL,
    "from_stage" VARCHAR(20),
    "to_stage" VARCHAR(20) NOT NULL,
    "action" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_key" ON "candidates"("email");

-- AddForeignKey
ALTER TABLE "candidate_history" ADD CONSTRAINT "candidate_history_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
