require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const translate = require('translate-google');

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// Get Lessons API
app.get('/api/lessons', async (req, res) => {
  const lessons = await prisma.lesson.findMany({
    include: {
      _count: {
        select: { words: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(lessons);
});

app.get('/api/lessons/:id', async (req, res) => {
  const { id } = req.params;
  const lesson = await prisma.lesson.findUnique({
    where: { id: parseInt(id) }
  });
  res.json(lesson);
});

// Add Lesson API
app.post('/api/lessons', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Lesson name is required' });
  const newLesson = await prisma.lesson.create({ data: { name } });
  res.status(201).json(newLesson);
});

// Check Word API (Get meanings from Dictionary)
app.post('/api/words/check', async (req, res) => {
  const { english } = req.body;
  if (!english) return res.status(400).json({ error: 'Word is required' });

  try {
    const wordStr = english.toLowerCase().trim();
    
    // 1. Get Phonetics and Meanings
    let suggestions = [];
    let phonetic = '';
    let audioUrl = '';

    try {
      const dictRes = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${wordStr}`);
      if (dictRes.data && dictRes.data[0]) {
        const entry = dictRes.data[0];
        phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
        audioUrl = entry.phonetics?.find(p => p.audio !== '')?.audio || '';

        suggestions = entry.meanings.map(m => ({
          partOfSpeech: m.partOfSpeech,
          definition: m.definitions[0]?.definition || ''
        }));
      }
    } catch (e) {
      console.error('Dictionary API error:', e.message);
    }

    // 2. Base Translation
    let vietnamese = '';
    try {
      vietnamese = await translate(wordStr, { to: 'vi' });
    } catch (e) {
      vietnamese = wordStr;
    }

    res.json({
      english: wordStr,
      vietnamese,
      phonetic,
      audioUrl,
      suggestions
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add Word API
app.post('/api/words', async (req, res) => {
  const { english, vietnamese, partOfSpeech, phonetic, audioUrl, description, lessonId } = req.body;
  
  if (!english || !lessonId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const newWord = await prisma.word.create({
      data: {
        english: english.toLowerCase().trim(),
        vietnamese,
        partOfSpeech,
        phonetic,
        audioUrl,
        description,
        lessonId: parseInt(lessonId)
      }
    });

    res.status(201).json(newWord);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Words API
app.get('/api/words', async (req, res) => {
  const { lessonId } = req.query;
  const filter = lessonId ? { lessonId: parseInt(lessonId) } : {};
  const words = await prisma.word.findMany({ 
    where: filter,
    orderBy: { createdAt: 'desc' } 
  });
  res.json(words);
});

// Get Exercises API
app.get('/api/exercises', async (req, res) => {
  const { lessonId, type } = req.query;
  const filter = lessonId ? { lessonId: parseInt(lessonId) } : {};
  const words = await prisma.word.findMany({ where: filter });
  
  if (words.length < 4) {
    return res.status(400).json({ error: 'Kho từ vựng chưa đủ 4 từ để bắt đầu luyện tập!' });
  }

  // Shuffle function
  const shuffle = (array) => array.sort(() => 0.5 - Math.random());

  const exercises = [];
  const shuffledWords = shuffle([...words]);

  if (type === 'vietnamese_to_word') {
    shuffledWords.forEach(w => {
      const options = shuffle([
        w.english,
        ...shuffle(words.filter(x => x.id !== w.id)).slice(0, 3).map(x => x.english)
      ]);
      const posTag = w.partOfSpeech ? `(${w.partOfSpeech}) ` : '';
      exercises.push({
        type: 'vietnamese_to_word',
        question: `Đoán từ vựng ${posTag}có nghĩa là: "${w.vietnamese}"`,
        options: options,
        answer: w.english,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        partOfSpeech: w.partOfSpeech
      });
    });
  } else if (type === 'description_to_word') {
    shuffledWords.forEach(w => {
      const options = shuffle([
        w.english,
        ...shuffle(words.filter(x => x.id !== w.id)).slice(0, 3).map(x => x.english)
      ]);
      const blankedDescription = (w.description || '').replace(new RegExp(w.english, 'gi'), '_____');
      const posTag = w.partOfSpeech ? `(${w.partOfSpeech}) ` : '';
      exercises.push({
        type: 'description_to_word',
        question: `Đoán từ ${posTag}qua mô tả: "${blankedDescription}"`,
        options: options,
        answer: w.english,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        partOfSpeech: w.partOfSpeech
      });
    });
  } else if (type === 'matching') {
    for (let i = 0; i < shuffledWords.length; i += 4) {
      const chunk = shuffledWords.slice(i, i + 4);
      if (chunk.length < 2) continue;
      const leftCol = shuffle(chunk.map(w => w.english));
      const rightCol = shuffle(chunk.map(w => w.vietnamese));
      exercises.push({
        type: 'matching',
        question: 'Nối từ tiếng Anh với nghĩa tiếng Việt',
        leftCol: leftCol,
        rightCol: rightCol,
        answerPairs: chunk.map(w => ({ 
          english: w.english, 
          vietnamese: w.vietnamese,
          phonetic: w.phonetic,
          audioUrl: w.audioUrl,
          partOfSpeech: w.partOfSpeech
        }))
      });
    }
  } else {
    return res.status(400).json({ error: 'Loại bài tập không hợp lệ.' });
  }

  res.json(exercises.slice(0, 15));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
