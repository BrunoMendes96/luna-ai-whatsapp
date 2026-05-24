import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const processedMessages = new Set();
const onlineUsers = {};
const activeAgents = {};
const DEFAULT_COMPANY_ID = "default_company";

io.on("connection", (socket) => {
  console.log("Painel conectado:", socket.id);

  socket.on("panel_online", (data) => {
    activeAgents[socket.id] = data.user;

    io.emit("online_agents", activeAgents);
  });

  socket.on("lead_opened", (data) => {
    io.emit("lead_selected", data);
  });

  socket.on("user_typing", (data) => {
    io.emit("typing", data);
  });

  socket.emit("connected", {
    success: true
  });

  socket.on("disconnect", () => {
    delete activeAgents[socket.id];

    io.emit("online_agents", activeAgents);

    console.log("Painel desconectado:", socket.id);
  });
});

function emitRealtime(event, data) {
  io.emit(event, data);
}

app.get("/", (req, res) => {
  res.send("Luna AI Enterprise online");
});

function detectAppointment(text) {
  const message = text.toLowerCase();

  const wantsAppointment =
    message.includes("agendamento") ||
    message.includes("agendar") ||
    message.includes("marcar") ||
    message.includes("horário") ||
    message.includes("horario") ||
    message.includes("às") ||
    message.includes("as ") ||
    message.includes("hora");

  if (!wantsAppointment) return null;

  const dateMatch =
    text.match(/\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/) ||
    text.match(/dia\s+\d{1,2}/i);

  const hourMatch =
    text.match(/\d{1,2}h\d{0,2}/i) ||
    text.match(/\d{1,2}:\d{2}/) ||
    text.match(/às\s+\d{1,2}/i) ||
    text.match(/as\s+\d{1,2}/i) ||
    text.match(/\d{1,2}\s*horas/i);

  if (!dateMatch || !hourMatch) return null;

  let service = "Serviço não informado";

  if (message.includes("piercing")) service = "Piercing";
  if (message.includes("tattoo") || message.includes("tatuagem")) service = "Tattoo";
  if (message.includes("estética") || message.includes("estetica")) service = "Estética";

  return {
    service,
    appointment_date: `${dateMatch[0]} ${hourMatch[0]}`
  };
}

async function saveMessage(phone, role, content, extra = {}) {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      company_id: DEFAULT_COMPANY_ID,
      phone,
      role,
      content,
      type: extra.type || "text",
      media_url: extra.media_url || "",
      media_mime_type: extra.media_mime_type || "",
      media_filename: extra.media_filename || "",
      profile_name: extra.profile_name || "",
      profile_picture: extra.profile_picture || "",
      tags: extra.tags || "",
      ai_suggestion: extra.ai_suggestion || "",
      unread_count: role === "user" ? 1 : 0
    })
    .select()
    .single();

  if (error) {
    console.error("ERRO SAVE MESSAGE:", error.message);
  }

  emitRealtime("new_message", {
    phone,
    role,
    content,
    ...extra
  });

  return data;
}

async function getHistory(phone) {
  const { data } = await supabase
    .from("conversations")
    .select("role, content")
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("phone", phone)
    .order("created_at", {
      ascending: true
    })
    .limit(12);

  return data || [];
}

async function generateSummary(phone) {
  const history = await getHistory(phone);

  if (history.length < 4) return "";

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
Resuma esta conversa em 1 frase curta para CRM.

Histórico:
${JSON.stringify(history)}
`
  });

  const summary = response.output_text || "";

  await supabase
    .from("conversations")
    .update({
      company_id: DEFAULT_COMPANY_ID,
      summary
    })
    .eq("phone", phone);

  emitRealtime("conversation_summary", {
    phone,
    summary
  });

  return summary;
}

async function generateSuggestion(phone) {
  const history = await getHistory(phone);

  if (history.length < 2) return "";

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
Você é uma atendente profissional da Luna Studio.

Gere uma sugestão curta de resposta para o atendente enviar ao cliente.
Não use texto longo.

Histórico:
${JSON.stringify(history)}
`
  });

  const suggestion = response.output_text || "";

  await supabase
    .from("conversations")
    .update({
      company_id: DEFAULT_COMPANY_ID,
      ai_suggestion: suggestion
    })
    .eq("phone", phone);

  emitRealtime("ai_suggestion", {
    phone,
    suggestion
  });

  return suggestion;
}

async function sendWhatsAppMessage(to, text) {
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

async function getWhatsAppMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/v20.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      }
    }
  );

  return response.data?.url || "";
}

app.get("/api/media/:mediaId", async (req, res) => {
  try {
    const { mediaId } = req.params;

    const mediaUrl = await getWhatsAppMediaUrl(mediaId);

    if (!mediaUrl) {
      return res.status(404).json({
        error: "Mídia não encontrada"
      });
    }

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      }
    });

    res.setHeader(
      "Content-Type",
      mediaResponse.headers["content-type"] || "application/octet-stream"
    );

    res.send(mediaResponse.data);
  } catch (error) {
    console.error("ERRO MEDIA:", error.response?.data || error.message);

    res.status(500).json({
      error: "Erro ao carregar mídia"
    });
  }
});

app.get("/api/conversations", async (req, res) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  const grouped = {};

  data.forEach((item) => {
    if (!grouped[item.phone]) {
      grouped[item.phone] = {
        phone: item.phone,
        status: item.status || "Novo Lead",
        customer_name: item.customer_name || "",
        notes: item.notes || "",
        profile_name: item.profile_name || "",
        profile_picture: item.profile_picture || "",
        summary: item.summary || "",
        tags: item.tags || "",
        ai_suggestion: item.ai_suggestion || "",
        unread_count: item.unread_count || 0,
        history: []
      };
    }

    grouped[item.phone].history.push({
      role: item.role,
      content: item.content,
      created_at: item.created_at,
      type: item.type || "text",
      media_url: item.media_url || "",
      media_mime_type: item.media_mime_type || "",
      media_filename: item.media_filename || ""
    });

    grouped[item.phone].unread_count += item.unread_count || 0;

    if (item.summary) grouped[item.phone].summary = item.summary;
    if (item.ai_suggestion) grouped[item.phone].ai_suggestion = item.ai_suggestion;
    if (item.tags) grouped[item.phone].tags = item.tags;
  });

  res.json(Object.values(grouped));
});

app.post("/api/conversations/status", async (req, res) => {
  const { phone, status } = req.body;

  await supabase
    .from("conversations")
    .update({ status })
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("phone", phone);

  emitRealtime("conversation_updated", {
    phone,
    status
  });

  res.json({ success: true });
});

app.post("/api/conversations/details", async (req, res) => {
  const { phone, customer_name, notes } = req.body;

  await supabase
    .from("conversations")
    .update({
      company_id: DEFAULT_COMPANY_ID,
      customer_name,
      notes
    })
    .eq("phone", phone);

  emitRealtime("conversation_updated", {
    phone
  });

  res.json({ success: true });
});

app.post("/api/conversations/tags", async (req, res) => {
  const { phone, tags } = req.body;

  await supabase
    .from("conversations")
    .update({
      company_id: DEFAULT_COMPANY_ID,
      tags
    })
    .eq("phone", phone);

  emitRealtime("conversation_updated", {
    phone,
    tags
  });

  res.json({ success: true });
});

app.post("/api/conversations/read", async (req, res) => {
  const { phone } = req.body;

  await supabase
    .from("conversations")
    .update({
      company_id: DEFAULT_COMPANY_ID,
      unread_count: 0
    })
    .eq("phone", phone);

  emitRealtime("conversation_updated", {
    phone
  });

  res.json({ success: true });
});

app.post("/api/ai-suggestion", async (req, res) => {
  try {
    const { phone } = req.body;

    const suggestion = await generateSuggestion(phone);

    res.json({
      suggestion
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    console.log("Webhook recebido");

    if (!message) {
      return res.sendStatus(200);
    }

    const messageId = message.id;
    const from = message.from;
    onlineUsers[from] = true;

emitRealtime("online_users", onlineUsers);

    if (processedMessages.has(messageId)) {
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);

    const profileName = contact?.profile?.name || "";

    let userText = "";
    let messageType = message.type || "text";
    let mediaUrl = "";
    let mediaMimeType = "";
    let mediaFilename = "";

    if (message.type === "text") {
      userText = message.text.body.trim();
    }

    if (message.type === "image") {
      userText = "Cliente enviou uma imagem.";
      mediaUrl = message.image?.id || "";
      mediaMimeType = message.image?.mime_type || "image/jpeg";
    }

    if (message.type === "audio") {
      userText = "Cliente enviou um áudio.";
      mediaUrl = message.audio?.id || "";
      mediaMimeType = message.audio?.mime_type || "audio/ogg";
    }

    if (message.type === "document") {
      userText = "Cliente enviou um documento.";
      mediaUrl = message.document?.id || "";
      mediaMimeType = message.document?.mime_type || "";
      mediaFilename = message.document?.filename || "documento";
    }

    if (!userText) {
      return res.sendStatus(200);
    }

    emitRealtime("typing", {
      phone: from,
      typing: true
    });

    await saveMessage(from, "user", userText, {
      type: messageType,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      media_filename: mediaFilename,
      profile_name: profileName
    });

    const history = await getHistory(from);

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Você é uma atendente da Luna Studio.

REGRAS:
- Responda curto.
- Seja natural.
- Não confirme agendamento automaticamente.
- Quando o cliente quiser horário, diga que vai verificar disponibilidade.
- Nunca invente horários.

Histórico:
${JSON.stringify(history)}

Cliente:
${userText}
`
    });

    let reply =
      response.output_text ||
      "Obrigada pela mensagem 😊 Vou verificar certinho para você.";

    const appointment = detectAppointment(userText);

    if (appointment) {
      await supabase
        .from("conversations")
        .update({
          company_id: DEFAULT_COMPANY_ID,
          status: "Aguardando Confirmação"
        })
        .eq("phone", from);

      reply = `Perfeito 😊

Recebi seu pedido:

Serviço: ${appointment.service}
Horário: ${appointment.appointment_date}

Vou verificar disponibilidade 💙`;
    }

    await saveMessage(from, "assistant", reply);

    await sendWhatsAppMessage(from, reply);

    await generateSummary(from);
    await generateSuggestion(from);

    emitRealtime("typing", {
      phone: from,
      typing: false
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("ERRO NO WEBHOOK:", error.response?.data || error.message);

    return res.sendStatus(200);
  }
});

app.post("/api/confirm-appointment", async (req, res) => {
  try {
    const {
      customer_name,
      phone,
      service,
      appointment_date,
      price
    } = req.body;

    const { data: existing, error: checkError } = await supabase
      .from("appointments")
      .select("*")
      .eq("appointment_date", appointment_date)
      .eq("confirmed", true);

    if (checkError) {
      return res.status(500).json({
        error: checkError.message
      });
    }

    if (existing && existing.length > 0) {
      const occupiedMessage = `Esse horário já está ocupado 😢

Pode me enviar outro dia ou horário que eu verifico para você?`;

      await sendWhatsAppMessage(phone, occupiedMessage);
      await saveMessage(phone, "assistant", occupiedMessage);

      return res.status(400).json({
        error: "Esse horário já está ocupado. Avisei o cliente no WhatsApp."
      });
    }

    const { error } = await supabase
      .from("appointments")
.insert({
  company_id: DEFAULT_COMPANY_ID,
  customer_name,
  phone,
  service,
  appointment_date,
  price: Number(price || 0),
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
        company_id: DEFAULT_COMPANY_ID,
        status: "Fechado",
        customer_name,
        unread_count: 0
      })
      .eq("phone", phone);

    const confirmationMessage = `Agendamento confirmado 😊

Serviço: ${service}
Data/Hora: ${appointment_date}

Esperamos você 💙`;

    await sendWhatsAppMessage(phone, confirmationMessage);
    await saveMessage(phone, "assistant", confirmationMessage);

    emitRealtime("appointment_confirmed", {
      phone,
      customer_name,
      service,
      appointment_date,
      price
    });

    res.json({
      success: true
    });
  } catch (error) {
    console.error("ERRO CONFIRMAR:", error.response?.data || error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/appointments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(data || []);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/send-message", async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        error: "Telefone e mensagem são obrigatórios"
      });
    }

    await sendWhatsAppMessage(phone, message);
    await saveMessage(phone, "assistant", message);
    await generateSummary(phone);
    await generateSuggestion(phone);

    res.json({
      success: true
    });
  } catch (error) {
    console.error("ERRO ENVIAR MANUAL:", error.response?.data || error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/follow-up", async (req, res) => {
  try {
    const { phone } = req.body;

    const message =
      "Oi 😊 Passando só para saber se ainda posso te ajudar com seu agendamento.";

    await sendWhatsAppMessage(phone, message);
    await saveMessage(phone, "assistant", message);

    res.json({
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Luna AI Enterprise rodando na porta ${PORT}`);
});