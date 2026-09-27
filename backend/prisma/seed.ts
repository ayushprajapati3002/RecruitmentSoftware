import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  // Add seed logic here later if needed
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
