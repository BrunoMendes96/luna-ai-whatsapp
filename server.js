import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { buildAgentPrompt } from "./agentPrompt.js";
import FormData from "form-data";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const processedMessages = new Set();

app.get("/", (req, res) => {
  res.send("Super Agente WhatsApp IA online.");
});

app.get("/api/conversations", async (req, res) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const grouped = {};

  data.forEach((item) => {
    if (!grouped[item.phone]) {
      grouped[item.phone] = {
        phone: item.phone,
        history: []
      };
    }

    grouped[item.phone].history.push({
      role: item.role,
      content: item.content
    });
  });

  res.json(Object.values(grouped));
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    console.log("Webhook recebido");

    if (!message) {
      return res.sendStatus(200);
    }

    const messageId = message.id;
    const from = message.from;

    if (processedMessages.has(messageId)) {
      console.log("Mensagem duplicada ignorada:", messageId);
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);

    let userText = "";

    if (message.type === "text") {
      userText = message.text.body.trim();
      console.log("Texto recebido:", userText);
    }

    if (message.type === "audio" || message.type === "voice") {
      const audioId = message.audio?.id || message.voice?.id;

      console.log("Áudio recebido. Media ID:", audioId);

      userText = await transcribeWhatsAppAudio(audioId);

      console.log("Áudio transcrito:", userText);
    }

    if (!userText) {
      console.log("Tipo não suportado:", message.type);

      await sendWhatsAppMessage(
        from,
        "Recebi sua mensagem ✨ No momento consigo responder textos e áudios."
      );

      return res.sendStatus(200);
    }

    await saveMessage(from, "user", userText);

    const history = await getHistory(from);

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: buildAgentPrompt(userText, history)
    });

let reply =  response.output_text ||
  "Obrigada pela mensagem ✨ Vou encaminhar para uma atendente confirmar certinho com você.";

const appointment = detectAppointment(userText);

if (appointment) {
  await supabase
    .from("conversations")
    .update({
      status: "Aguardando Confirmação"
    })
    .eq("phone", from);

  reply = `Perfeito 😊

Recebi seu pedido de agendamento para:

Serviço: ${appointment.service}
Horário solicitado: ${appointment.appointment_date}

Vou verificar disponibilidade e já confirmo para você 💙`;
}
    await saveMessage(from, "assistant", reply);

    console.log("Resposta IA:", reply);

    await sendWhatsAppMessage(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("ERRO NO WEBHOOK:", error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

async function transcribeWhatsAppAudio(mediaId) {
  console.log("Buscando URL do áudio na Meta...");

  const mediaUrlResponse = await axios.get(
    `https://graph.facebook.com/v20.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      }
    }
  );

  const mediaUrl = mediaUrlResponse.data.url;

  const audioResponse = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
    }
  });

  const audioPath = path.join(process.cwd(), `audio-${Date.now()}.ogg`);

  fs.writeFileSync(audioPath, audioResponse.data);

  console.log("Áudio baixado. Transcrevendo...");

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1"
  });

  fs.unlinkSync(audioPath);

  return transcription.text;
}

async function saveMessage(phone, role, content) {
  const { error } = await supabase.from("conversations").insert({
    phone,
    role,
    content
  });

  if (error) {
    console.error("Erro ao salvar no Supabase:", error.message);
  }
}

async function getHistory(phone) {
  const { data, error } = await supabase
    .from("conversations")
    .select("role, content")
    .eq("phone", phone)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("Erro ao buscar histórico:", error.message);
    return [];
  }

  return data || [];
}

async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Mensagem enviada com sucesso.");
  } catch (error) {
    console.error(
      "ERRO AO ENVIAR WHATSAPP:",
      error.response?.data || error.message
    );
  }
}

async function generateSpeechAudio(text) {
  const audioPath = path.join(process.cwd(), `reply-${Date.now()}.mp3`);

  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "nova",
    input: text
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(audioPath, buffer);

  return audioPath;
}

async function uploadWhatsAppAudio(audioPath) {
  const formData = new FormData();

  formData.append("messaging_product", "whatsapp");
  formData.append("type", "audio/mpeg");
  formData.append("file", fs.createReadStream(audioPath));

  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/media`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        ...formData.getHeaders()
      }
    }
  );

  return response.data.id;
}

async function sendTextFallback(to, text) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: text
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.post("/api/conversations/status", async (req, res) => {
  try {
    const { phone, status } = req.body;

    const { error } = await supabase
      .from("conversations")
      .update({ status })
      .eq("phone", phone);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/conversations/details", async (req, res) => {
  try {
    const { phone, customer_name, notes } = req.body;

    const { error } = await supabase
      .from("conversations")
      .update({ customer_name, notes })
      .eq("phone", phone);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function detectAppointment(text) {
  const message = text.toLowerCase();

  const wantsAppointment =
    message.includes("agendar") ||
    message.includes("marcar") ||
    message.includes("marca") ||
    message.includes("horário") ||
    message.includes("horario") ||
    message.includes("vaga");

  if (!wantsAppointment) {
    return null;
  }

  let service = "Serviço não informado";

  if (message.includes("piercing")) {
    service = "Piercing";
  }

  if (
    message.includes("tattoo") ||
    message.includes("tatuagem")
  ) {
    service = "Tattoo";
  }

  if (
    message.includes("estética") ||
    message.includes("estetica")
  ) {
    service = "Estética";
  }

  const dateMatch = text.match(
    /\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/
  );

  const hourMatch =
    text.match(/\d{1,2}h\d{0,2}/i) ||
    text.match(/\d{1,2}:\d{2}/);

  if (!dateMatch || !hourMatch) {
    return null;
  }

  return {
    service,
    appointment_date: `${dateMatch[0]} ${hourMatch[0]}`
  };
}

app.post("/api/confirm-appointment", async (req, res) => {
  try {
    const {
      customer_name,
      phone,
      service,
      appointment_date
    } = req.body;

    const { data: existing } = await supabase
      .from("appointments")
      .select("*")
      .eq("appointment_date", appointment_date)
      .eq("confirmed", true);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        error: "Horário já ocupado"
      });
    }

    const { error } = await supabase
      .from("appointments")
      .insert({
        customer_name,
        phone,
        service,
        appointment_date,
        confirmed: true
      });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    await supabase
      .from("conversations")
      .update({
        status: "Fechado"
      })
      .eq("phone", phone);

    const confirmationMessage = `Agendamento confirmado 😊

Serviço: ${service}
Data/Hora: ${appointment_date}

Esperamos você 💙`;

    await sendWhatsAppMessage(
      phone,
      confirmationMessage
    );

    res.json({
      success: true
    });
  } catch (error) {
    console.error(
      "ERRO CONFIRMAR:",
      error.message
    );

    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Super Agente rodando na porta ${process.env.PORT || 3000}`);
});