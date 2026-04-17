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
  
  // Handle single or multiple lessonIds
  let filter = {};
  if (lessonId) {
    const ids = lessonId.toString().split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    if (ids.length > 0) {
      filter = { lessonId: { in: ids } };
    }
  }

  const words = await prisma.word.findMany({ where: filter });
  
  if (words.length < 4) {
    return res.status(400).json({ error: 'Kho từ vựng chưa đủ 4 từ để bắt đầu luyện tập!' });
  }

  // Shuffle function
  const shuffle = (array) => [...array].sort(() => 0.5 - Math.random());

  // Advanced Distractor logic
  const getSmartDistractors = (targetWord, allWords, recentAnswers) => {
    let candidates = allWords.filter(x => x.id !== targetWord.id);
    let filteredCandidates = candidates.filter(x => !recentAnswers.includes(x.english));
    
    // Ensure we have at least 3 candidates. If temporal filter is too strict, ignore it.
    const pool = filteredCandidates.length >= 3 ? filteredCandidates : candidates;
    
    // Priority: Same Part of Speech
    let samePOS = pool.filter(x => x.partOfSpeech === targetWord.partOfSpeech);
    let differentPOS = pool.filter(x => x.partOfSpeech !== targetWord.partOfSpeech);
    
    let selected = shuffle(samePOS).slice(0, 3);
    if (selected.length < 3) {
      const remaining = 3 - selected.length;
      selected = [...selected, ...shuffle(differentPOS).slice(0, remaining)];
    }
    
    return selected.map(x => x.english);
  };

  const exercises = [];
  const shuffledWords = shuffle([...words]);
  const recentAnswers = []; // History for temporal separation (size 5)

  if (type === 'vietnamese_to_word' || type === 'kahoot' || type === 'description_to_word') {
    shuffledWords.forEach(w => {
      const wrongOptions = getSmartDistractors(w, words, recentAnswers);
      const options = shuffle([w.english, ...wrongOptions]);
      
      let question = '';
      if (type === 'description_to_word') {
        const blankedDescription = (w.description || '').replace(new RegExp(w.english, 'gi'), '_____');
        const posTag = w.partOfSpeech ? `(${w.partOfSpeech}) ` : '';
        question = `Đoán từ ${posTag}qua mô tả: "${blankedDescription}"`;
      } else {
        question = `Nghĩa của từ này là gì: "${w.vietnamese}"?`;
      }

      exercises.push({
        type: type,
        question: question,
        options: options,
        answer: w.english,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        partOfSpeech: w.partOfSpeech,
        vietnamese: w.vietnamese
      });

      // Update history
      recentAnswers.push(w.english);
      if (recentAnswers.length > 5) recentAnswers.shift();
    });
  } else if (type === 'word_typing') {
    shuffledWords.forEach(w => {
      exercises.push({
        type: 'word_typing',
        question: `Hãy nhập từ tiếng Anh có nghĩa là: "${w.vietnamese}"`,
        answer: w.english,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
        partOfSpeech: w.partOfSpeech,
        vietnamese: w.vietnamese
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

  res.json(exercises.slice(0, 100));
});

// Delete Lesson API
app.delete('/api/lessons/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.lesson.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Lesson deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete Word API
app.delete('/api/words/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.word.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Word deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend is running on port ${PORT}`);
});
