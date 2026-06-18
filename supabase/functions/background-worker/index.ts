// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";


console.log("🚀 Background Worker initialized: Ready to process BrainDumps.");

// Environment variables
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log("📥 Received webhook payload for table:", payload.table);

    // Supabase DB Webhook payload format
    if (payload.type !== "INSERT" || payload.table !== "processing_queue") {
      console.log("⏭️ Ignored: Not an INSERT event on the processing_queue table.");
      return new Response("Ignored non-INSERT or non-queue event", { status: 200 });
    }

    const queueRecord = payload.record;
    if (!queueRecord || queueRecord.status !== "pending") {
      console.log("⏭️ Ignored: Record is not in 'pending' status.");
      return new Response("No pending record found", { status: 200 });
    }

    const queueId = queueRecord.id;
    const chatId = queueRecord.telegram_id;
    const fileId = queueRecord.file_id;

    console.log(`⚙️ Processing Queue ID: ${queueId} for Chat ID: ${chatId}`);

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Mark as processing
    await supabase.from("processing_queue").update({ status: "processing" }).eq("id", queueId);

    // 2. Fetch user keys
    const { data: userKeys, error: keysError } = await supabase
      .from("user_keys")
      .select("deepgram_api_key, gemini_api_key")
      .eq("telegram_id", chatId)
      .single();

    if (keysError || !userKeys) {
      console.error(`❌ Missing API keys for Chat ID: ${chatId}`);
      await sendStatusUpdate(supabase, queueId, chatId, "error", "⚠️ **Authentication Error:** Could not find your API keys. Please set them up using the `/keys` command.");
      return new Response("OK");
    }

    const deepgramApiKey = userKeys.deepgram_api_key;
    const geminiApiKey = userKeys.gemini_api_key;

    // 3. Download audio from Telegram
    console.log("⬇️ Downloading audio file from Telegram...");
    const fileRes = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData.result.file_path;
    
    const audioUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${filePath}`;
    const audioRes = await fetch(audioUrl);
    const audioBuffer = await audioRes.arrayBuffer();

    // 4. Transcribe with Deepgram
    console.log("🎙️ Sending audio to Deepgram for transcription...");
    const deepgramRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
          "Content-Type": "audio/ogg", 
        },
        body: audioBuffer,
      }
    );

    if (!deepgramRes.ok) {
       console.error("❌ Deepgram API error:", await deepgramRes.text());
       await sendStatusUpdate(supabase, queueId, chatId, "error", "❌ **Transcription Failed:** Deepgram could not process the audio. Please verify that your Deepgram API key is valid and funded.");
       return new Response("OK");
    }

    const deepgramData = await deepgramRes.json();
    const transcript = deepgramData.results?.channels[0]?.alternatives[0]?.transcript;

    if (!transcript || transcript.trim() === "") {
      console.warn("⚠️ Deepgram returned an empty transcript.");
      await sendStatusUpdate(supabase, queueId, chatId, "error", "⚠️ **No Audio Detected:** I couldn't hear any clear words in that audio file. Please try recording again in a quieter environment.");
      return new Response("OK");
    }

    console.log("✅ Transcription complete. Length:", transcript.length, "characters.");

    // 5. Structure with Gemini
    console.log("🧠 Sending transcript to Gemini for structuring...");
    const geminiPrompt = `
You are an elite executive assistant and structural editor. Your objective is to take raw, unstructured, and often rambling audio transcripts (brain dumps) and transform them into highly organized, clear, and actionable Markdown documents.

Follow these strict rules:
1. **Preserve the Core Ideas:** Never drop, delete, or hallucinate information. Capture every distinct idea, even if it feels disjointed or minor.
2. **Clean the Delivery:** Remove verbal tics (ums, ahs, "like", "you know"), false starts, and duplicate words. Fix grammar and syntax to make it read smoothly, but maintain the speaker's original intent and tone.
3. **Structure Logically:** Group related concepts together. Invent clear, descriptive headings (## or ###) for different topics discussed in the transcript.
4. **Extract Action Items:** If any tasks, deliverables, questions to research, or future to-dos are mentioned, extract them and place them in a dedicated bulleted "## 🎯 Action Items" section at the bottom.
5. **Format in Strict Markdown:** Use bolding for key terms, bullet points for lists, and clean spacing. Do NOT wrap the final output in markdown code blocks (e.g., \`\`\`markdown). Just return the raw formatted text so it is ready to be saved directly as an .md file.

Here is the raw transcript to process:
"${transcript}"
`;
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: geminiPrompt }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const geminiErrorBody = await geminiRes.text();
      console.error("❌ Gemini API error:", geminiRes.status, geminiErrorBody);
      let geminiErrorReason = `HTTP ${geminiRes.status}`;
      try {
        const parsed = JSON.parse(geminiErrorBody);
        const msg = parsed?.error?.message;
        if (msg) geminiErrorReason += `: ${msg}`;
      } catch { /* non-JSON body, use status only */ }
      await sendStatusUpdate(supabase, queueId, chatId, "error", `❌ **AI Processing Failed:** Gemini returned an error.\n\`${geminiErrorReason}\`\n\nHere is your raw transcript so you don't lose your thoughts:\n\n${transcript}`);
      return new Response("OK");
    }

    const geminiData = await geminiRes.json();
    const structuredText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (structuredText) {
      // 6. Generate Markdown File & Send to Telegram
      console.log("📄 Generating Markdown document...");
      
      // Clean up markdown block formatting if Gemini disobeys Rule #5
      const cleanStructuredText = structuredText.replace(/^```markdown\n/, "").replace(/\n```$/, "");

      // Better Information Hierarchy: Structured text at the top, Raw Transcript at the bottom in a blockquote.
      const documentContent = `# 🧠 Structured BrainDump\n\n${cleanStructuredText}\n\n---\n\n## 🎙️ Raw Transcript Archive\n> ${transcript}`;
      
      const blob = new Blob([documentContent], { type: 'text/markdown' });
      const formData = new FormData();
      formData.append("chat_id", chatId.toString());
      
      const dateString = new Date().toISOString().replace(/[:.]/g, "-");
      const mdFilename = `BrainDump_${dateString}.md`;
      formData.append("document", blob, mdFilename);
      formData.append("caption", "✅ **BrainDump Processed!** Here are your structured notes.");

      console.log("📤 Sending Markdown document back to Telegram chat...");
      const sendDocRes = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendDocument`, {
        method: "POST",
        body: formData,
      });

      if (!sendDocRes.ok) {
         console.error("❌ Failed to send Markdown document to Telegram:", await sendDocRes.text());
         await sendStatusUpdate(supabase, queueId, chatId, "error", `❌ **Delivery Failed:** Could not send the Markdown file to the chat.\n\nHere is your raw text backup:\n\n${transcript}`);
      } else {


         console.log("🎉 Process completed successfully! Marking queue as completed.");
         // Mark as completed
         await supabase.from("processing_queue").update({ status: "completed" }).eq("id", queueId);
      }
    } else {
       console.error("❌ Gemini returned an empty response body.");
       await sendStatusUpdate(supabase, queueId, chatId, "error", `❌ **AI Error:** Gemini failed to generate a structured response.\n\nHere is your raw transcript backup:\n\n${transcript}`);
    }

    return new Response("OK");
  } catch (error) {
    console.error("💥 Fatal error in queue worker:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// Helper to update DB and optionally notify the user
async function sendStatusUpdate(supabase: any, queueId: string, chatId: number, status: string, message?: string) {
  // Update DB 
  await supabase.from("processing_queue").update({ status: status }).eq("id", queueId);
  
  // Notify User if provided
  if (message) {
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  }
}
