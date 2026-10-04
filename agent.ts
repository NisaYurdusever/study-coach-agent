import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const apiKey = process.env.GEMINI_API_KEY || '';

if (!apiKey) {
  console.error('❌ HATA: GEMINI_API_KEY ortam değişkeni okunamadı!');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// 1. Tool Tanımları
const readStudyMaterialTool: FunctionDeclaration = {
  name: 'read_study_material',
  description: 'Reads technical study material from the local grounded knowledge base file.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: { type: Type.STRING, description: 'The topic to look up, e.g. modal_dialog' },
    },
    required: ['topic'],
  },
};

const updateProgressLedgerTool: FunctionDeclaration = {
  name: 'update_progress_ledger',
  description: 'Appends candidate evaluation score and study notes to progress_ledger.json.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: { type: Type.STRING, description: 'Topic evaluated' },
      score: { type: Type.NUMBER, description: 'Score out of 100' },
      notes: { type: Type.STRING, description: 'Feedback and mastery assessment' },
    },
    required: ['topic', 'score', 'notes'],
  },
};

// 2. Tool Çalıştırma
function executeTool(name: string, args: any): string {
  if (name === 'read_study_material') {
    const filePath = path.join(process.cwd(), 'knowledge_base.txt');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return 'Error: Knowledge base file not found.';
  }

  if (name === 'update_progress_ledger') {
    const ledgerPath = path.join(process.cwd(), 'progress_ledger.json');
    let currentData: any[] = [];
    if (fs.existsSync(ledgerPath)) {
      try {
        const raw = fs.readFileSync(ledgerPath, 'utf-8');
        currentData = raw.trim() ? JSON.parse(raw) : [];
      } catch {
        currentData = [];
      }
    }
    const entry = {
      timestamp: new Date().toISOString(),
      topic: args?.topic || 'General',
      score: args?.score || 0,
      notes: args?.notes || '',
    };
    currentData.push(entry);
    fs.writeFileSync(ledgerPath, JSON.stringify(currentData, null, 2), 'utf-8');
    return `Success: Ledger updated with score ${args?.score}/100.`;
  }

  return `Error: Unknown tool ${name}`;
}

// 503 / Yoğunluk Hatalarını Yöneten Yeniden Deneme Fonksiyonu
async function sendWithRetry(chatSession: any, payload: any, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chatSession.sendMessage(payload);
    } catch (err: any) {
      if ((err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('demand')) && attempt < maxRetries) {
        console.log(`\n⏳ Sunucu yoğun, 2 saniye sonra tekrar deneniyor (Deneme ${attempt}/${maxRetries})...`);
        await new Promise((res) => setTimeout(res, 2000));
      } else {
        throw err;
      }
    }
  }
}

// 3. Agent Execution Loop
async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

  console.log('🤖 Technical Study Coach Agent initialized.');
  console.log('Type your goal (e.g., "Drill me on W3C ARIA Modal focus traps"):');

  const userGoal = await ask('\nCandidate > ');

  const systemInstruction = `You are a strict, source-grounded Technical Study & Interview Coach.
Rules:
1. Always call 'read_study_material' before asking questions.
2. Present a rigorous technical challenge based strictly on the retrieved source material.
3. When the user answers, evaluate their response, provide constructive feedback, and then call 'update_progress_ledger' to save their score and notes.
4. Keep commentary concise and technical.`;

  const chat = ai.chats.create({
    model: 'gemini-3.8-flash',
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [readStudyMaterialTool, updateProgressLedgerTool] }],
    },
  });

  let response = await sendWithRetry(chat, { message: userGoal });

  while (response.functionCalls && response.functionCalls.length > 0) {
    for (const call of response.functionCalls) {
      console.log(`\n⚙️ [Tool Call] Executing '${call.name}' with args:`, call.args);
      const toolResult = executeTool(call.name, call.args);
      console.log(`✅ [Tool Result]: ${toolResult.slice(0, 100)}...`);

      response = await sendWithRetry(chat, {
        message: [
          {
            functionResponse: {
              name: call.name,
              response: { result: toolResult },
            },
          },
        ],
      });
    }
  }

  console.log(`\nCoach > ${response.text ?? ''}\n`);

  const candidateAnswer = await ask('Candidate > ');
  let followUp = await sendWithRetry(chat, { message: candidateAnswer });

  while (followUp.functionCalls && followUp.functionCalls.length > 0) {
    for (const call of followUp.functionCalls) {
      console.log(`\n⚙️ [Tool Call] Executing '${call.name}' with args:`, call.args);
      const toolResult = executeTool(call.name, call.args);
      console.log(`✅ [Tool Result]: ${toolResult}`);

      followUp = await sendWithRetry(chat, {
        message: [
          {
            functionResponse: {
              name: call.name,
              response: { result: toolResult },
            },
          },
        ],
      });
    }
  }

  console.log(`\nCoach > ${followUp.text ?? ''}\n`);
  rl.close();
}

run().catch(console.error);