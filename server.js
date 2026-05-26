import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);
import fs from "fs";
import FormData from "form-data";
import multer from "multer";
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

  socket.on("panel_online", async (data) => {
    const userEmail = data?.user || "";
    activeAgents[socket.id] = userEmail;

    if (userEmail) {
      await supabase
        .from("crm_agents")
        .update({ online: true })
        .eq("company_id", DEFAULT_COMPANY_ID)
        .eq("email", userEmail);
    }

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

  socket.on("disconnect", async () => {
    const userEmail = activeAgents[socket.id];

    if (userEmail) {
      await supabase
        .from("crm_agents")
        .update({ online: false })
        .eq("company_id", DEFAULT_COMPANY_ID)
        .eq("email", userEmail);
    }

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

async function getDefaultAgent() {
  const { data } = await supabase
    .from("crm_agents")
    .select("*")
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return data || {
    name: "Admin",
    email: "bruno.coop32@icloud.com"
  };
}

async function getLeastBusyAgent() {
  const { data: agents } = await supabase
    .from("crm_agents")
    .select("*")
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (!agents || agents.length === 0) {
    return getDefaultAgent();
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select("phone, assigned_to_email")
    .eq("company_id", DEFAULT_COMPANY_ID);

  const loadByEmail = {};

  agents.forEach((agent) => {
    loadByEmail[agent.email] = 0;
  });

  const uniquePhones = new Set();

  (conversations || []).forEach((item) => {
    const key = `${item.phone}-${item.assigned_to_email}`;

    if (
      !uniquePhones.has(key) &&
      loadByEmail[item.assigned_to_email] !== undefined
    ) {
      uniquePhones.add(key);
      loadByEmail[item.assigned_to_email] += 1;
    }
  });

  return agents.reduce((leastBusy, agent) => {
    const currentLoad = loadByEmail[agent.email] || 0;
    const leastLoad = loadByEmail[leastBusy.email] || 0;

    return currentLoad < leastLoad ? agent : leastBusy;
  }, agents[0]);
}

async function logAgentActivity({
  agent_email = "",
  agent_name = "",
  action = "",
  phone = "",
  metadata = {}
}) {
  try {
    await supabase.from("crm_agent_activity").insert({
      company_id: DEFAULT_COMPANY_ID,
      agent_email,
      agent_name,
      action,
      phone,
      metadata
    });
  } catch (error) {
    console.error("ERRO LOG ACTIVITY:", error.message);
  }
}

async function getAgentsDashboard() {
  const { data: agents, error: agentsError } = await supabase
    .from("crm_agents")
    .select("*")
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (agentsError) throw agentsError;

  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("phone, status, assigned_to, assigned_to_email, unread_count")
    .eq("company_id", DEFAULT_COMPANY_ID);

  if (conversationsError) throw conversationsError;

  const { data: appointments, error: appointmentsError } = await supabase
    .from("appointments")
    .select("phone, price, confirmed")
    .eq("company_id", DEFAULT_COMPANY_ID);

  if (appointmentsError) throw appointmentsError;

  const groupedLeads = {};
  const groupedAppointments = {};

  (conversations || []).forEach((item) => {
    if (!item.phone || groupedLeads[item.phone]) return;
    groupedLeads[item.phone] = item;
  });

  (appointments || []).forEach((item) => {
    if (!groupedAppointments[item.phone]) {
      groupedAppointments[item.phone] = [];
    }

    groupedAppointments[item.phone].push(item);
  });

  return (agents || []).map((agent) => {
    const leads = Object.values(groupedLeads).filter(
      (item) => item.assigned_to_email === agent.email
    );

    const closed = leads.filter((item) => item.status === "Fechado").length;

    const activeLeads = leads.filter(
      (item) => !["Fechado", "Perdido"].includes(item.status || "Novo Lead")
    ).length;

    const unread = leads.reduce((total, item) => {
      return total + Number(item.unread_count || 0);
    }, 0);

    const revenue = leads.reduce((total, lead) => {
      const leadAppointments = groupedAppointments[lead.phone] || [];

      return (
        total +
        leadAppointments.reduce((sum, appointment) => {
          return sum + Number(appointment.price || 0);
        }, 0)
      );
    }, 0);

    const commissionRate = Number(agent.commission_rate || 0);
    const monthlyGoal = Number(agent.monthly_goal || 0);
    const commission = (revenue * commissionRate) / 100;
    const goalProgress =
      monthlyGoal > 0 ? Math.min(100, Math.round((revenue / monthlyGoal) * 100)) : 0;

    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      online: agent.online,
      commission_rate: commissionRate,
      monthly_goal: monthlyGoal,
      leads_total: leads.length,
      active_leads: activeLeads,
      closed_leads: closed,
      unread_messages: unread,
      revenue,
      commission,
      goal_progress: goalProgress
    };
  });
}

async function saveMessage(phone, role, content, extra = {}) {
  const assignedAgent = extra.assignedAgent || (await getLeastBusyAgent());

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
      assigned_to: extra.assigned_to || assignedAgent?.name || "Admin",
      assigned_to_email:
        extra.assigned_to_email ||
        assignedAgent?.email ||
        "bruno.coop32@icloud.com",
      priority: extra.priority || "Quente",
      last_activity: new Date().toISOString(),
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
      summary,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
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
      ai_suggestion: suggestion,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
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

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase
      .from("crm_agents")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("email", email)
      .eq("password", password)
      .eq("active", true)
      .single();

    if (error || !data) {
      return res.status(401).json({
        error: "Email ou senha inválidos"
      });
    }

    await logAgentActivity({
      agent_email: data.email,
      agent_name: data.name,
      action: "login",
      metadata: {
        role: data.role
      }
    });

    res.json({
      success: true,
      user: {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/dashboard/agents", async (req, res) => {
  try {
    const dashboard = await getAgentsDashboard();

    res.json(dashboard);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/agent/activity", async (req, res) => {
  try {
    const { agent_email } = req.query;

    let query = supabase
      .from("crm_agent_activity")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .order("created_at", { ascending: false })
      .limit(100);

    if (agent_email) {
      query = query.eq("agent_email", agent_email);
    }

    const { data, error } = await query;

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

app.get("/api/agents", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("crm_agents")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/agents", async (req, res) => {
  try {
    const { name, email, role = "agent" } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "Nome e email são obrigatórios"
      });
    }

    const { data, error } = await supabase
      .from("crm_agents")
      .insert({
        company_id: DEFAULT_COMPANY_ID,
        name,
        email,
        role,
        active: true,
        online: false
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    emitRealtime("agents_updated", data);

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/conversations/assign", async (req, res) => {
  try {
    const { phone, assigned_to, assigned_to_email } = req.body;

    if (!phone || !assigned_to || !assigned_to_email) {
      return res.status(400).json({
        error: "phone, assigned_to e assigned_to_email são obrigatórios"
      });
    }

    const { error } = await supabase
      .from("conversations")
      .update({
        assigned_to,
        assigned_to_email,
        last_activity: new Date().toISOString()
      })
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("phone", phone);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logAgentActivity({
      agent_email: assigned_to_email,
      agent_name: assigned_to,
      action: "lead_assigned",
      phone,
      metadata: {
        assigned_to,
        assigned_to_email
      }
    });

    emitRealtime("conversation_assigned", {
      phone,
      assigned_to,
      assigned_to_email
    });

    emitRealtime("conversation_updated", { phone });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/conversations/auto-assign", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "phone é obrigatório" });
    }

    const agent = await getLeastBusyAgent();

    const { error } = await supabase
      .from("conversations")
      .update({
        assigned_to: agent.name,
        assigned_to_email: agent.email,
        last_activity: new Date().toISOString()
      })
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("phone", phone);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logAgentActivity({
      agent_email: agent.email,
      agent_name: agent.name,
      action: "lead_auto_assigned",
      phone,
      metadata: {
        assigned_to: agent.name,
        assigned_to_email: agent.email
      }
    });

    emitRealtime("conversation_assigned", {
      phone,
      assigned_to: agent.name,
      assigned_to_email: agent.email
    });

    emitRealtime("conversation_updated", { phone });

    res.json({
      success: true,
      agent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/conversations", async (req, res) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("company_id", DEFAULT_COMPANY_ID)
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
        assigned_to: item.assigned_to || "Admin",
        assigned_to_email: item.assigned_to_email || "bruno.coop32@icloud.com",
        priority: item.priority || "Quente",
        last_activity: item.last_activity || item.created_at,
        unread_count: 0,
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
    if (item.assigned_to) grouped[item.phone].assigned_to = item.assigned_to;
    if (item.assigned_to_email) {
      grouped[item.phone].assigned_to_email = item.assigned_to_email;
    }
    if (item.priority) grouped[item.phone].priority = item.priority;
    if (item.last_activity) grouped[item.phone].last_activity = item.last_activity;
  });

  res.json(Object.values(grouped));
});

app.post("/api/conversations/status", async (req, res) => {
  const { phone, status } = req.body;

  await supabase
    .from("conversations")
    .update({
      status,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("phone", phone);

  await logAgentActivity({
    action: "status_updated",
    phone,
    metadata: {
      status
    }
  });

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
      customer_name,
      notes,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("phone", phone);

  await logAgentActivity({
    action: "details_updated",
    phone,
    metadata: {
      customer_name
    }
  });

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
      tags,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
    .eq("phone", phone);

  await logAgentActivity({
    action: "tags_updated",
    phone,
    metadata: {
      tags
    }
  });

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
      unread_count: 0,
      last_activity: new Date().toISOString()
    })
    .eq("company_id", DEFAULT_COMPANY_ID)
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

    const assignedAgent = await getLeastBusyAgent();

    await saveMessage(from, "user", userText, {
      type: messageType,
      media_url: mediaUrl,
      media_mime_type: finalMime,
      media_filename: finalName,
      profile_name: profileName,
      assignedAgent
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
          status: "Aguardando Confirmação",
          last_activity: new Date().toISOString()
        })
        .eq("company_id", DEFAULT_COMPANY_ID)
        .eq("phone", from);

      reply = `Perfeito 😊

Recebi seu pedido:

Serviço: ${appointment.service}
Horário: ${appointment.appointment_date}

Vou verificar disponibilidade 💙`;
    }

    await saveMessage(from, "assistant", reply, {
      assignedAgent
    });

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
        status: "Fechado",
        customer_name,
        unread_count: 0,
        last_activity: new Date().toISOString()
      })
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("phone", phone);

    const confirmationMessage = `Agendamento confirmado 😊

Serviço: ${service}
Data/Hora: ${appointment_date}

Esperamos você 💙`;

    await sendWhatsAppMessage(phone, confirmationMessage);
    await saveMessage(phone, "assistant", confirmationMessage);

    await logAgentActivity({
      action: "appointment_confirmed",
      phone,
      metadata: {
        customer_name,
        service,
        appointment_date,
        price
      }
    });

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
      .eq("company_id", DEFAULT_COMPANY_ID)
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

    await logAgentActivity({
      action: "manual_message_sent",
      phone,
      metadata: {
        message
      }
    });

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



const upload = multer({
  dest: "uploads/"
});

app.post(
  "/api/send-media",
  upload.single("file"),
  async (req, res) => {
    try {
      const { phone } = req.body;
      const file = req.file;
      console.log("UPLOAD RECEBIDO:", {
  originalname: file?.originalname,
  mimetype: file?.mimetype,
  path: file?.path
});

      if (!phone || !file) {
        return res.status(400).json({
          error: "Telefone e arquivo obrigatórios"
        });
      }

let finalPath = file.path;
let finalMime = file.mimetype;
let finalName = file.originalname;

if (
  file.mimetype.includes("webm") ||
  file.originalname.toLowerCase().endsWith(".webm") ||
  file.mimetype === "application/octet-stream"
) {
  const outputPath = `${file.path}.ogg`;

  await new Promise((resolve, reject) => {
    ffmpeg(file.path)
      .audioCodec("libopus")
      .format("ogg")
      .save(outputPath)
      .on("end", resolve)
      .on("error", (err) => {
  console.error("FFMPEG ERROR:", err.message);
  reject(err);
});
  });

  finalPath = outputPath;
  finalMime = "audio/ogg";
  finalName = "audio.ogg";
}

      const formData = new FormData();

      formData.append(
        "messaging_product",
        "whatsapp"
      );

      formData.append(
        "file",
        fs.createReadStream(finalPath),
        {
          filename: finalName,
          contentType: finalMime
        }
      );

      const uploadResponse =
        await axios.post(
          `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/media`,
          formData,
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
              ...formData.getHeaders()
            }
          }
        );

      const mediaId =
        uploadResponse.data.id;

      let type = "document";

      if (
        file.mimetype.startsWith(
          "image/"
        )
      ) {
        type = "image";
      }

      if (finalMime.startsWith("audio/")) {
  type = "audio";
}

      if (
        file.mimetype.startsWith(
          "video/"
        )
      ) {
        type = "video";
      }

if (
  finalMime.startsWith(
    "audio/"
  )
) {
  type = "document";
}

      await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product:
            "whatsapp",
          to: phone,
          type,
          [type]: type === "document"
  ? {
      id: mediaId,
      filename: finalName
    }
  : {
      id: mediaId
    }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type":
              "application/json"
          }
        }
      );

     await saveMessage(
  phone,
  "assistant",
  `Arquivo enviado: ${finalName}`,
  {
    type,
    media_url: mediaId,
    media_mime_type:
      finalMime,
    media_filename:
      finalName
  }
);

      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
if (finalPath !== file.path && fs.existsSync(finalPath)) fs.unlinkSync(finalPath);

      res.json({
        success: true
      });
    } catch (error) {
      console.error(
        "SEND MEDIA ERROR:",
        error.response?.data ||
          error.message
      );

      res.status(500).json({
        error:
          error.response?.data
            ?.error?.message ||
          "Erro ao enviar mídia"
      });
    }
  }
);

app.post("/api/follow-up", async (req, res) => {
  try {
    const { phone } = req.body;

    const message =
      "Oi 😊 Passando só para saber se ainda posso te ajudar com seu agendamento.";

    await sendWhatsAppMessage(phone, message);
    await saveMessage(phone, "assistant", message);

    await logAgentActivity({
      action: "follow_up_sent",
      phone,
      metadata: {
        message
      }
    });

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
