const axios = require('axios');
const fs = require('fs');
const path = require('path');

// CONFIGURATION
const RENDER_API_URL = 'https://vocabuilder-be.onrender.com/api';

async function importData() {
  const dataPath = path.join(__dirname, '..', 'data_backup.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error('Error: data_backup.json not found. Please run export_local.js first.');
    return;
  }

  const lessons = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`--- Starting Production Import to ${RENDER_API_URL} ---`);
  console.log(`Found ${lessons.length} lessons to import.`);

  for (const lesson of lessons) {
    try {
      console.log(`\nImporting Lesson: "${lesson.name}"...`);
      
      // 1. Create Lesson on Production
      const lessonRes = await axios.post(`${RENDER_API_URL}/lessons`, {
        name: lesson.name
      });
      
      const newLessonId = lessonRes.data.id;
      console.log(`   -> Created with new ID: ${newLessonId}`);

      // 2. Create Words for this Lesson
      if (lesson.words && lesson.words.length > 0) {
        console.log(`   -> Importing ${lesson.words.length} words...`);
        for (const word of lesson.words) {
          await axios.post(`${RENDER_API_URL}/words`, {
            english: word.english,
            vietnamese: word.vietnamese,
            partOfSpeech: word.partOfSpeech,
            phonetic: word.phonetic,
            audioUrl: word.audioUrl,
            description: word.description,
            lessonId: newLessonId // Use the NEW lesson ID
          });
        }
        console.log(`   -> Finished ${lesson.words.length} words.`);
      }
    } catch (error) {
      console.error(`   !! Error importing lesson "${lesson.name}":`, error.response?.data || error.message);
    }
  }

  console.log('\n--- Migration Complete! ---');
  console.log('Check your website to see the results.');
}

importData();
