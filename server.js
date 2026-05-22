import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

app.use(cors());
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
  res.send("Super Agente online");
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

app.post("/api/conversations/status", async (req, res) => {
  const { phone, status } = req.body;

  await supabase
    .from("conversations")
    .update({ status })
    .eq("phone", phone);

  res.json({ success: true });
});

app.post("/api/conversations/details", async (req, res) => {
  const { phone, customer_name, notes } = req.body;

  await supabase
    .from("conversations")
    .update({
      customer_name,
      notes
    })
    .eq("phone", phone);

  res.json({ success: true });
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
    message.includes("as ");

  if (!wantsAppointment) {
    return null;
  }

  const dateMatch = text.match(
    /\d{1,2}[\/\-]\d{1,2}/
  );

  const hourMatch =
    text.match(/\d{1,2}h\d{0,2}/i) ||
    text.match(/\d{1,2}:\d{2}/);

  if (!dateMatch || !hourMatch) {
    return null;
  }

  let service = "Serviço";

  if (message.includes("piercing")) {
    service = "Piercing";
  }

  if (
    message.includes("tattoo") ||
    message.includes("tatuagem")
  ) {
    service = "Tattoo";
  }

  return {
    service,
    appointment_date: `${dateMatch[0]} ${hourMatch[0]}`
  };
}

async function saveMessage(phone, role, content) {
  await supabase.from("conversations").insert({
    phone,
    role,
    content
  });
}

async function getHistory(phone) {
  const { data } = await supabase
    .from("conversations")
    .select("role, content")
    .eq("phone", phone)
    .order("created_at", {
      ascending: true
    })
    .limit(10);

  return data || [];
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

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    console.log("Webhook recebido");

    if (!message) {
      return res.sendStatus(200);
    }

    const messageId = message.id;
    const from = message.from;

    if (processedMessages.has(messageId)) {
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);

    let userText = "";

    if (message.type === "text") {
      userText = message.text.body.trim();
    }

    if (!userText) {
      return res.sendStatus(200);
    }

    console.log("Texto recebido:", userText);

    await saveMessage(from, "user", userText);

    const history = await getHistory(from);

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Você é uma atendente da Luna Studio.

Seja curta e natural.

Histórico:
${JSON.stringify(history)}

Cliente:
${userText}
`
    });

    let reply =
      response.output_text ||
      "Obrigada pela mensagem 😊";

    const appointment =
      detectAppointment(userText);

    if (appointment) {
      await supabase
        .from("conversations")
        .update({
          status:
            "Aguardando Confirmação"
        })
        .eq("phone", from);

      reply = `Perfeito 😊

Recebi seu pedido:

Serviço: ${appointment.service}
Horário: ${appointment.appointment_date}

Vou verificar disponibilidade 💙`;
    }

    await saveMessage(
      from,
      "assistant",
      reply
    );

    console.log("Resposta IA:", reply);

    await sendWhatsAppMessage(
      from,
      reply
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error(
      "ERRO NO WEBHOOK:",
      error.response?.data ||
        error.message
    );

    return res.sendStatus(200);
  }
});

app.post("/api/confirm-appointment", async (req, res) => {
  try {
    const {
      customer_name,
      phone,
      service,
      appointment_date
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

  await supabase.from("conversations").insert({
    phone,
    role: "assistant",
    content: occupiedMessage,
    status: "Aguardando Confirmação",
    customer_name
  });

  return res.status(400).json({
    error: "Esse horário já está ocupado. Avisei o cliente no WhatsApp."
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
        status: "Fechado",
        customer_name
      })
      .eq("phone", phone);

    const confirmationMessage = `Agendamento confirmado 😊

Serviço: ${service}
Data/Hora: ${appointment_date}

Esperamos você 💙`;

    await sendWhatsAppMessage(phone, confirmationMessage);

    await supabase.from("conversations").insert({
      phone,
      role: "assistant",
      content: confirmationMessage,
      status: "Fechado",
      customer_name
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

app.listen(
  process.env.PORT || 3000,
  () => {
    console.log(
      `Super Agente rodando na porta ${
        process.env.PORT || 3000
      }`
    );
  }
);