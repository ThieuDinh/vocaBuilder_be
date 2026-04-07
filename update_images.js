const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const words = await prisma.word.findMany();
  for (const w of words) {
    const sanitizedWord = w.english.replace(/\s+/g, ',');
    const freshUrl = `https://loremflickr.com/600/400/${encodeURIComponent(sanitizedWord)}/all`;
    await prisma.word.update({
      where: { id: w.id },
      data: { imageUrl: freshUrl }
    });
  }
  console.log('Update complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
