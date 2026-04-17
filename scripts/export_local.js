const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportData() {
  console.log('--- Starting Local Export ---');
  
  try {
    const lessons = await prisma.lesson.findMany({
      include: { words: true }
    });

    const exportPath = path.join(__dirname, '..', 'data_backup.json');
    fs.writeFileSync(exportPath, JSON.stringify(lessons, null, 2));

    console.log(`Successfully exported ${lessons.length} lessons and their words to: data_backup.json`);
  } catch (error) {
    console.error('Export failed:', error);
    console.log('\nTIP: Make sure you have set provider="sqlite" in schema.prisma and ran "npx prisma generate" before running this script.');
  } finally {
    await prisma.$disconnect();
  }
}

exportData();
