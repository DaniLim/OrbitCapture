# Voice-to-Text AI BrainDump Bot - User Guide

Welcome to your private BrainDump Telegram Bot! This bot uses Deepgram for lightning-fast voice transcription and Google Gemini to structure your ramblings into organized, actionable notes.

## 🔒 Privacy First (Bring Your Own Keys)

To keep your data completely private and control costs, the bot does not use shared API keys. You must provide your own keys.

Here is how to get them:

### 1. Get a Deepgram API Key (For Audio Transcription)
1. Go to [Deepgram Console](https://console.deepgram.com/).
2. Create an account or log in.
3. In the left sidebar, click on **API Keys**.
4. Click **Create a New API Key**.
5. Give it a name (e.g., "Telegram Bot"), assign it the "Member" role, and set it to never expire.
6. Copy the generated key. (It looks something like `1234abcd5678efgh...`)

### 2. Get a Google Gemini API Key (For Text Structuring)
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Log in with your Google account.
3. Click **Create API key** > **Create API key in new project**.
4. Copy the generated key.

---

## 🚀 How to Connect Your Keys to the Bot

1. Open Telegram and navigate to your bot: **@Orbitcapture_bot**
2. Type `/start` to wake it up.
3. Send a single message with both of your keys in this exact format:
   ```
   /keys YOUR_DEEPGRAM_KEY YOUR_GEMINI_KEY
   ```
   Example:
   ```
   /keys 1234abcd5678efgh AIzaSyB_abcdefg12345
   ```
4. The bot will reply with a confirmation message if the keys were saved successfully.

---

## 🎙️ Using the Bot

Once your keys are set up, using the bot is incredibly simple!

1. Open the chat with **@Orbitcapture_bot**.
2. Tap and hold the **Microphone** icon to record a voice note.
3. Speak your thoughts, ideas, or to-dos. Don't worry about structuring them—just brain dump!
4. Send the voice note.
5. In a few seconds, the bot will transcribe your audio and send back a structured, formatted markdown summary of your thoughts.

## 🛠 Troubleshooting
- **Bot is unresponsive:** Make sure the Supabase database and edge functions are active.
- **"Failed to transcribe audio":** Ensure your Deepgram API key is correct and has credits.
- **"Failed to structure text":** Ensure your Gemini API key is correct. You can update your keys at any time by sending the `/keys` command again.
