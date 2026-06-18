// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

console.log("Hello from Telegram Webhook!");

// Environment variables provided by Supabase Edge Functions
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const update = await req.json();
    console.log("Received update:", JSON.stringify(update, null, 2));

    // Handle normal messages
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;

      // Initialize Supabase client
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Handle text commands
      if (message.text) {
        if (message.text.startsWith("/start")) {
          const welcomeMsg = `*Welcome to BrainDump Bot!* 🧠

This bot uses Deepgram for transcription and Google Gemini to structure your voice notes into organized, actionable text.

*🔒 Privacy First (Bring Your Own Keys)*
To keep your data completely private, you must provide your own API keys.

*1. Get a Deepgram API Key (Audio Transcription)*
• Go to console.deepgram.com
• Create an account and go to *API Keys* > *Create a New API Key*
• Copy the generated key.

*2. Get a Google Gemini API Key (Text Structuring)*
• Go to aistudio.google.com/app/apikey
• Click *Create API key*
• Copy the generated key.

*🚀 How to Connect*
Reply to this bot with your keys in this exact format:
\`/keys YOUR_DEEPGRAM_KEY YOUR_GEMINI_KEY\``;

          await sendMessage(chatId, welcomeMsg, "Markdown");
          return new Response("OK");
        }

        if (message.text.startsWith("/keys ")) {
          const parts = message.text.split(" ");
          if (parts.length === 3) {
            const deepgramKey = parts[1];
            const geminiKey = parts[2];

            // Save to database
            const { error } = await supabase
              .from("user_keys")
              .upsert({
                telegram_id: chatId,
                deepgram_api_key: deepgramKey,
                gemini_api_key: geminiKey,
              });

            if (error) {
              console.error("DB Error:", error);
              await sendMessage(
                chatId,
                "Failed to save your keys. Please try again later."
              );
            } else {
              await sendMessage(
                chatId,
                "✅ Keys saved successfully! Send me a voice message to get started."
              );
            }
          } else {
            await sendMessage(
              chatId,
              "Invalid format. Please use:\n`/keys DEEPGRAM_KEY GEMINI_KEY`"
            );
          }
          return new Response("OK");
        }
      }

      // Handle Voice Messages
      if (message.voice) {
        // 1. Fetch user keys to ensure they are onboarded
        const { data: userKeys, error: keysError } = await supabase
          .from("user_keys")
          .select("deepgram_api_key, gemini_api_key")
          .eq("telegram_id", chatId)
          .single();

        if (keysError || !userKeys) {
          await sendMessage(
            chatId,
            "⚠️ You need to set your API keys first. Use `/keys DEEPGRAM_KEY GEMINI_KEY`"
          );
          return new Response("OK");
        }

        const fileId = message.voice.file_id;

        // 2. Insert into Processing Queue
        const { error: insertError } = await supabase
          .from("processing_queue")
          .insert({
            telegram_id: chatId,
            file_id: fileId,
            status: "pending",
          });

        if (insertError) {
          console.error("Failed to insert into processing queue:", insertError);
          await sendMessage(
            chatId,
            "❌ An error occurred queueing your audio. Please try again later."
          );
          return new Response("OK");
        }

        // 3. Instant Acknowledgement
        await sendMessage(
          chatId,
          "🎙️ Audio received! Processing your structured document..."
        );
        return new Response("OK");
      }
    }

    return new Response("OK");
  } catch (error) {
    console.error("Error processing update:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// Helper to send messages back to Telegram
async function sendMessage(chatId: number, text: string, parseMode?: string) {
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text: text,
  };
  if (parseMode) {
    body.parse_mode = parseMode;
  }

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
