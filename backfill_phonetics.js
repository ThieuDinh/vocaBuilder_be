const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

async function backfill() {
  const words = await prisma.word.findMany({
    where: {
      OR: [
        { phonetic: null },
        { phonetic: '' },
        { audioUrl: null },
        { audioUrl: '' }
      ]
    }
  });

  console.log(`Found ${words.length} words to backfill...`);

  for (const w of words) {
    try {
      console.log(`Fetching data for: ${w.english}`);
      const dictRes = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${w.english}`);
      if (dictRes.data && dictRes.data[0]) {
        const entry = dictRes.data[0];
        
        const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
        let audioUrl = '';
        if (entry.phonetics && entry.phonetics.length > 0) {
          const audioEntry = entry.phonetics.find(p => p.audio !== '');
          if (audioEntry) {
            audioUrl = audioEntry.audio;
          }
        }

        await prisma.word.update({
          where: { id: w.id },
          data: { phonetic, audioUrl }
        });
        console.log(`Successfully updated ${w.english}`);
      }
      // Add a small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Error fetching ${w.english}:`, e.message);
    }
  }

  console.log('Backfill complete!');
}

backfill()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
