import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from "recharts";

const API_URL = "https://luna-ai-whatsapp-production.up.railway.app";
const socket = io(API_URL, { transports: ["websocket", "polling"] });

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

const COLORS = ["#8b5cf6", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR"
  });
}

function formatTime(date) {
  if (!date) return "";

  return new Date(date).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(date) {
  if (!date) return "Sem atividade";

  return new Date(date).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 920;

    oscillator.connect(gain);
    gain.connect(audio.destination);

    gain.gain.setValueAtTime(0.15, audio.currentTime);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
    oscillator.stop(audio.currentTime + 0.5);
  } catch (error) {
    console.log("Som bloqueado:", error.message);
  }
}

function getLastMessage(conversation) {
  if (!conversation?.history?.length) return "Sem mensagens";

  return conversation.history[conversation.history.length - 1]?.content || "Sem mensagens";
}

function getLastMessageTime(conversation) {
  if (!conversation?.history?.length) return "";

  return formatTime(conversation.history[conversation.history.length - 1]?.created_at);
}

function getLeadName(conversation) {
  return conversation?.customer_name || conversation?.profile_name || "Cliente";
}

function isAgentOnline(agent, onlineAgents) {
  if (!agent?.email) return false;

  return Object.values(onlineAgents || {}).includes(agent.email) || agent.online;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const current = payload[0];

  return (
    <div className="bg-[#050816] border border-zinc-700 rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-xs text-zinc-400">{label || current?.name || "Valor"}</p>
      <p className="text-sm font-bold text-white">
        {current?.dataKey === "value" ? formatMoney(current?.value) : current?.value}
      </p>
    </div>
  );
}

function Avatar({ conversation }) {
  const customPhoto = localStorage.getItem(`avatar_${conversation.phone}`);

  if (customPhoto) {
    return (
      <img
        src={customPhoto}
        className="w-10 h-10 rounded-full object-cover border border-white/10"
        alt="Avatar"
      />
    );
  }

  const firstLetter = getLeadName(conversation).charAt(0).toUpperCase();

  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-bold border border-white/10">
      {firstLetter}
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("luna_admin");
    return saved ? JSON.parse(saved) : null;
  });

  const [email, setEmail] = useState(localStorage.getItem("saved_email") || "");
  const [password, setPassword] = useState(localStorage.getItem("saved_password") || "");
  const [remember, setRemember] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [agents, setAgents] = useState([]);
  const [replyMessage, setReplyMessage] = useState({});
  const [search, setSearch] = useState("");
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUsers, setOnlineUsers] = useState({});
  const [onlineAgents, setOnlineAgents] = useState({});
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [toasts, setToasts] = useState([]);

  const interactedRef = useRef(false);
  const lastMessageCountRef = useRef(0);

  const activeConversation = useMemo(() => {
    if (!selectedConversation?.phone) return null;
    return (
      conversations.find((item) => item.phone === selectedConversation.phone) ||
      selectedConversation
    );
  }, [conversations, selectedConversation]);

  const totalRevenue = appointments.reduce((total, item) => {
    return total + Number(item.price || 0);
  }, 0);

  const averageTicket = appointments.length > 0 ? totalRevenue / appointments.length : 0;

  const closedLeads = conversations.filter((item) => item.status === "Fechado").length;

  const activeLeads = conversations.filter(
    (item) => !["Fechado", "Perdido"].includes(item.status || "Novo Lead")
  ).length;

  const statusData = STATUS_OPTIONS.map((status) => ({
    name: status.replace("Aguardando Confirmação", "Confirmação"),
    total: conversations.filter((item) => (item.status || "Novo Lead") === status).length
  }));

  const revenueData = appointments
    .map((item, index) => ({
      name: item.customer_name || `#${index + 1}`,
      value: Number(item.price || 0)
    }))
    .filter((item) => item.value > 0);

  function addToast(message) {
    const id = Date.now();

    setToasts((prev) => [...prev, { id, message }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }

  async function loadConversations(options = {}) {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();

      if (!Array.isArray(data)) return;

      setConversations(data);

      const totalMessages = data.reduce((total, item) => {
        return total + (item.history?.length || 0);
      }, 0);

      if (
        !options.silent &&
        lastMessageCountRef.current !== 0 &&
        totalMessages > lastMessageCountRef.current
      ) {
        if (interactedRef.current) playBeep();
        addToast("Nova mensagem recebida");
      }

      lastMessageCountRef.current = totalMessages;
    } catch (error) {
      console.error(error);
    }
  }

  async function loadAppointments() {
    try {
      const response = await fetch(`${API_URL}/api/appointments`);
      const data = await response.json();
      setAppointments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  }

  async function loadAgents() {
    try {
      const response = await fetch(`${API_URL}/api/agents`);
      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        setAgents(data);
      } else {
        setAgents([
          {
            name: "Admin",
            email: "bruno.coop32@icloud.com",
            role: "admin",
            online: true
          }
        ]);
      }
    } catch (error) {
      console.error(error);
      setAgents([
        {
          name: "Admin",
          email: "bruno.coop32@icloud.com",
          role: "admin",
          online: true
        }
      ]);
    }
  }

  async function updateStatus(phone, status) {
    await fetch(`${API_URL}/api/conversations/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, status })
    });

    await loadConversations({ silent: true });
  }

  async function updateDetails(phone, customer_name, notes) {
    await fetch(`${API_URL}/api/conversations/details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, customer_name, notes })
    });

    await loadConversations({ silent: true });
  }

  async function updateTags(phone, tags) {
    await fetch(`${API_URL}/api/conversations/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, tags })
    });

    await loadConversations({ silent: true });
  }

  async function assignAgent(phone, agentEmail) {
    const agent = agents.find((item) => item.email === agentEmail);

    if (!agent) return;

    const response = await fetch(`${API_URL}/api/conversations/assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone,
        assigned_to: agent.name,
        assigned_to_email: agent.email
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao atribuir atendente");
      return;
    }

    addToast(`Lead atribuído para ${agent.name}`);
    await loadConversations({ silent: true });
  }

  async function autoAssignAgent(phone) {
    const response = await fetch(`${API_URL}/api/conversations/auto-assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro na distribuição automática");
      return;
    }

    addToast(`Distribuído para ${data.agent?.name || "atendente"}`);
    await loadConversations({ silent: true });
  }

  async function generateSuggestion(phone) {
    await fetch(`${API_URL}/api/ai-suggestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    addToast("Sugestão IA gerada");
    await loadConversations({ silent: true });
  }

  async function followUp(phone) {
    await fetch(`${API_URL}/api/follow-up`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    addToast("Follow-up enviado");
    await loadConversations({ silent: true });
  }

  async function markAsRead(phone) {
    await fetch(`${API_URL}/api/conversations/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    await loadConversations({ silent: true });
  }

  async function sendManualMessage(phone) {
    const message = replyMessage[phone];

    if (!message?.trim()) return;

    const response = await fetch(`${API_URL}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, message })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao enviar mensagem");
      return;
    }

    setReplyMessage((prev) => ({
      ...prev,
      [phone]: ""
    }));

    addToast("Mensagem enviada");
    await loadConversations({ silent: true });
  }

  async function confirmAppointment(conversation) {
    const service = prompt("Serviço:", "Piercing") || "Serviço não informado";
    const appointmentDate = prompt("Data e hora:", "25/05 15:00") || "";
    const price = prompt("Valor do serviço em euro:", "50") || "0";

    if (!appointmentDate) return;

    const response = await fetch(`${API_URL}/api/confirm-appointment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        customer_name: conversation.customer_name || conversation.profile_name || "Cliente",
        phone: conversation.phone,
        service,
        appointment_date: appointmentDate,
        price
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao confirmar agendamento");
      return;
    }

    addToast("Agendamento confirmado");
    await loadAppointments();
    await loadConversations({ silent: true });
  }

  async function handleDragEnd(result) {
    if (!result.destination) return;

    await updateStatus(result.draggableId, result.destination.droppableId);
    addToast("Lead movido");
  }

  function login(e) {
    e.preventDefault();

    if (
      email.trim().toLowerCase() === "bruno.coop32@icloud.com" &&
      password.trim() === "jaftYw-nirke9-dibsab"
    ) {
      const adminSession = {
        user: {
          email: "bruno.coop32@icloud.com"
        }
      };

      localStorage.setItem("luna_admin", JSON.stringify(adminSession));

      if (remember) {
        localStorage.setItem("saved_email", email);
        localStorage.setItem("saved_password", password);
      } else {
        localStorage.removeItem("saved_email");
        localStorage.removeItem("saved_password");
      }

      setSession(adminSession);
      return;
    }

    alert("Login inválido");
  }

  function logout() {
    localStorage.removeItem("luna_admin");
    setSession(null);
  }

  useEffect(() => {
    if (!session) return;

    loadConversations({ silent: true });
    loadAppointments();
    loadAgents();

    socket.emit("panel_online", {
      user: session.user.email
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("panel_online", {
        user: session.user.email
      });
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("new_message", (data) => {
      if (interactedRef.current) playBeep();
      addToast(`Nova mensagem: ${data.phone || "cliente"}`);
      loadConversations({ silent: true });
    });

    socket.on("conversation_updated", () => {
      loadConversations({ silent: true });
    });

    socket.on("conversation_assigned", () => {
      loadConversations({ silent: true });
    });

    socket.on("agents_updated", () => {
      loadAgents();
    });

    socket.on("appointment_confirmed", () => {
      loadAppointments();
      loadConversations({ silent: true });
    });

    socket.on("typing", (data) => {
      setTypingUsers((prev) => ({
        ...prev,
        [data.phone]: data.typing
      }));
    });

    socket.on("online_users", (users) => {
      setOnlineUsers(users || {});
    });

    socket.on("online_agents", (users) => {
      setOnlineAgents(users || {});
      loadAgents();
    });

    socket.on("conversation_summary", () => {
      loadConversations({ silent: true });
    });

    socket.on("ai_suggestion", () => {
      loadConversations({ silent: true });
    });

    const fallback = setInterval(() => {
      if (!socket.connected) {
        loadConversations({ silent: true });
        loadAppointments();
        loadAgents();
      }
    }, 8000);

    return () => {
      clearInterval(fallback);
      socket.off("connect");
      socket.off("disconnect");
      socket.off("new_message");
      socket.off("conversation_updated");
      socket.off("conversation_assigned");
      socket.off("agents_updated");
      socket.off("appointment_confirmed");
      socket.off("typing");
      socket.off("online_users");
      socket.off("online_agents");
      socket.off("conversation_summary");
      socket.off("ai_suggestion");
    };
  }, [session]);

  if (!session) {
    return (
      <div className="min-h-screen bg-[#050816] text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-[#0b1023] p-8 rounded-3xl w-full max-w-sm border border-zinc-800 shadow-2xl"
        >
          <h1 className="text-3xl font-black mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Luna AI
          </h1>

          <p className="text-zinc-400 text-sm mb-6">Painel Enterprise</p>

          <input
            className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl mb-3 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl mb-4 outline-none"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label className="flex items-center gap-2 mb-5 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Lembrar acesso
          </label>

          <button className="w-full bg-white text-black p-3 rounded-xl font-bold">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#050816] text-white p-4"
      onClick={() => {
        interactedRef.current = true;
      }}
    >
      <ToastArea toasts={toasts} />

      <div className="max-w-[1900px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-5">
          <div>
            <h1 className="text-3xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              Luna AI Enterprise
            </h1>

            <div className="flex flex-wrap items-center gap-2 mt-1">
              <p className="text-zinc-400 text-sm">{session.user.email}</p>
              <span className="text-zinc-700">•</span>
              <p className="text-xs text-purple-300">Empresa: Luna Studio</p>
              <span
                className={`w-2 h-2 rounded-full ${
                  socketConnected ? "bg-green-400" : "bg-red-400"
                }`}
              />
              <p className="text-xs text-zinc-500">
                {socketConnected ? "Realtime ativo" : "Reconectando"}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/10 border border-red-500/40 text-red-400 px-4 py-2 rounded-xl text-sm"
          >
            Sair
          </button>
        </div>

        <AgentBar agents={agents} onlineAgents={onlineAgents} />

        <div className="mb-5 grid grid-cols-1 lg:grid-cols-[1fr_210px] gap-3">
          <input
            type="text"
            placeholder="Buscar lead por nome, telefone, observação ou mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 outline-none text-sm focus:border-purple-500"
          />

          <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 text-sm flex justify-between items-center">
            <span className="text-zinc-400">Leads ativos</span>
            <strong>{activeLeads}</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <FinanceCard title="Faturamento" value={formatMoney(totalRevenue)} subtitle="Total confirmado" />
          <FinanceCard title="Agendamentos" value={appointments.length} subtitle="Agenda total" />
          <FinanceCard title="Ticket Médio" value={formatMoney(averageTicket)} subtitle="Média por cliente" />
          <FinanceCard title="Fechados" value={closedLeads} subtitle="Leads ganhos" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
          <ChartBox title="Leads por Status">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="name" tick={{ fill: "#999", fontSize: 10 }} />
                <YAxis tick={{ fill: "#999", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                  {statusData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>

          <ChartBox title="Faturamento">
            {revenueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={revenueData} dataKey="value" nameKey="name" outerRadius={88} innerRadius={42}>
                    {revenueData.map((entry, index) => (
                      <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[210px] flex items-center justify-center text-zinc-500 text-sm">
                Nenhum faturamento registrado ainda
              </div>
            )}
          </ChartBox>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 2xl:grid-cols-[1fr_460px] gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              {STATUS_OPTIONS.map((status) => (
                <Column
                  key={status}
                  status={status}
                  conversations={conversations}
                  search={search}
                  selectedConversation={activeConversation}
                  setSelectedConversation={setSelectedConversation}
                  typingUsers={typingUsers}
                  updateStatus={updateStatus}
                  followUp={followUp}
                  generateSuggestion={generateSuggestion}
                  socket={socket}
                />
              ))}
            </div>

            <LeadPanel
              conversation={activeConversation}
              typingUsers={typingUsers}
              onlineUsers={onlineUsers}
              agents={agents}
              onlineAgents={onlineAgents}
              updateStatus={updateStatus}
              updateDetails={updateDetails}
              updateTags={updateTags}
              assignAgent={assignAgent}
              autoAssignAgent={autoAssignAgent}
              confirmAppointment={confirmAppointment}
              sendManualMessage={sendManualMessage}
              replyMessage={replyMessage}
              setReplyMessage={setReplyMessage}
              followUp={followUp}
              generateSuggestion={generateSuggestion}
              markAsRead={markAsRead}
              closePanel={() => setSelectedConversation(null)}
            />
          </div>
        </DragDropContext>

        <Appointments appointments={appointments} />
      </div>
    </div>
  );
}

function AgentBar({ agents, onlineAgents }) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4 mb-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Equipe de atendimento</p>
          <p className="text-xs text-zinc-500">Multi-atendentes preparado para distribuição de leads</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => {
            const online = isAgentOnline(agent, onlineAgents);

            return (
              <div
                key={agent.email || agent.name}
                className="bg-[#050816] border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2"
              >
                <span className={`w-2 h-2 rounded-full ${online ? "bg-green-400" : "bg-zinc-500"}`} />
                <span className="text-xs text-zinc-300">{agent.name}</span>
                <span className="text-[10px] text-zinc-500">{online ? "online" : "offline"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Column({
  status,
  conversations,
  search,
  selectedConversation,
  setSelectedConversation,
  typingUsers,
  updateStatus,
  followUp,
  generateSuggestion,
  socket
}) {
  const filtered = conversations
    .filter((item) => (item.status || "Novo Lead") === status)
    .filter((item) => {
      const searchText = search.trim().toLowerCase();

      if (!searchText) return true;

      const values = [
        item.phone,
        item.customer_name,
        item.profile_name,
        item.notes,
        item.summary,
        item.assigned_to,
        item.assigned_to_email,
        getLastMessage(item)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return values.includes(searchText);
    })
    .reverse();

  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`bg-[#0b1023] border rounded-3xl h-[540px] overflow-hidden transition ${
            snapshot.isDraggingOver ? "border-purple-500 bg-purple-500/10" : "border-zinc-800"
          }`}
        >
          <div className="flex justify-between items-center p-4 border-b border-white/10">
            <h2 className="font-bold text-sm">{status}</h2>
            <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">{filtered.length}</span>
          </div>

          <div className="h-[470px] overflow-y-auto p-3 space-y-3">
            {filtered.map((conversation, index) => {
              const isSelected = selectedConversation?.phone === conversation.phone;

              return (
                <Draggable key={conversation.phone} draggableId={conversation.phone} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      onClick={() => {
                        setSelectedConversation(conversation);
                        socket.emit("lead_opened", { phone: conversation.phone });
                      }}
                      className={`bg-[#111827] border rounded-2xl p-3 transition cursor-pointer ${
                        isSelected ? "border-purple-500 ring-2 ring-purple-500/40" : "border-white/10"
                      } ${snapshot.isDragging ? "ring-2 ring-purple-500 scale-[1.02]" : ""}`}
                    >
                      <div
                        {...provided.dragHandleProps}
                        className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar conversation={conversation} />

                          <div className="min-w-0">
                            <p className="font-bold text-sm truncate">{getLeadName(conversation)}</p>
                            <p className="text-[10px] text-zinc-400 truncate">{conversation.phone}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {typingUsers[conversation.phone] && (
                            <span className="text-[10px] text-green-400 animate-pulse">digitando</span>
                          )}

                          <span className="bg-purple-500/20 text-purple-300 text-[10px] px-2 py-1 rounded-lg">
                            {conversation.unread_count || 0}
                          </span>
                        </div>
                      </div>

                      <div className="mb-2">
                        <p className="text-xs text-zinc-400">Última mensagem</p>
                        <p className="text-xs truncate">{getLastMessage(conversation)}</p>
                        <p className="text-[10px] text-zinc-500 mt-1">{getLastMessageTime(conversation)}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-[10px] px-2 py-1 rounded-full bg-red-500/20 text-red-300">
                          🔴 {conversation.priority || "Quente"}
                        </span>

                        <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {conversation.assigned_to || "Admin"}
                        </span>
                      </div>

                      {conversation.summary && (
                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-2 mb-3">
                          <p className="text-[10px] text-purple-300">Resumo IA</p>
                          <p className="text-[11px] text-zinc-300 truncate">{conversation.summary}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            followUp(conversation.phone);
                          }}
                          className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-lg py-2 text-xs"
                        >
                          Follow-up
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            generateSuggestion(conversation.phone);
                          }}
                          className="bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-lg py-2 text-xs"
                        >
                          IA
                        </button>
                      </div>

                      <select
                        className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 text-xs"
                        value={conversation.status || "Novo Lead"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateStatus(conversation.phone, e.target.value)}
                      >
                        {STATUS_OPTIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </Draggable>
              );
            })}

            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}

function LeadPanel({
  conversation,
  typingUsers,
  onlineUsers,
  agents,
  onlineAgents,
  updateStatus,
  updateDetails,
  updateTags,
  assignAgent,
  autoAssignAgent,
  confirmAppointment,
  sendManualMessage,
  replyMessage,
  setReplyMessage,
  followUp,
  generateSuggestion,
  markAsRead,
  closePanel
}) {
  if (!conversation) {
    return (
      <div className="bg-[#0b1023] border border-zinc-800 rounded-3xl p-6 min-h-[540px] 2xl:sticky 2xl:top-4 hidden 2xl:flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✨</span>
          </div>

          <h2 className="font-black text-xl mb-2">Selecione um lead</h2>

          <p className="text-sm text-zinc-400 max-w-xs">
            Clique em qualquer card para abrir histórico, IA, tags, responsável e atendimento completo.
          </p>
        </div>
      </div>
    );
  }

  const isOnline = Boolean(onlineUsers[conversation.phone]);

  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-3xl overflow-hidden 2xl:sticky 2xl:top-4 h-auto 2xl:h-[calc(100vh-32px)] flex flex-col">
      <div className="p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-blue-500/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar conversation={conversation} />

            <div className="min-w-0">
              <h2 className="font-black text-lg truncate">{getLeadName(conversation)}</h2>
              <p className="text-xs text-zinc-400 truncate">{conversation.phone}</p>

              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-400" : "bg-zinc-500"}`} />
                <span className="text-[10px] text-zinc-400">
                  {isOnline ? "Online agora" : "Offline"}
                </span>
                <span className="text-[10px] text-zinc-600">•</span>
                <span className="text-[10px] text-zinc-400">
                  {formatDateTime(conversation.last_activity)}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={closePanel}
            className="bg-white/10 hover:bg-white/20 text-zinc-300 rounded-xl px-3 py-2 text-xs"
          >
            Fechar
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <button
            onClick={() => followUp(conversation.phone)}
            className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-xl py-2 text-xs"
          >
            Follow-up
          </button>
          <button
  onClick={() => autoAssignAgent(conversation.phone)}
  className="bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-xl py-2 text-xs"
>
  Auto distribuir
</button>

          <button
            onClick={() => generateSuggestion(conversation.phone)}
            className="bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-xl py-2 text-xs"
          >
            Gerar IA
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <InfoBox label="Prioridade" value={`🔴 ${conversation.priority || "Quente"}`} />
          <InfoBox label="Não lidas" value={conversation.unread_count || 0} />
        </div>

        <div className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3">
          <p className="text-[10px] text-zinc-400 mb-2">Status</p>
          <select
            className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-3 text-xs"
            value={conversation.status || "Novo Lead"}
            onChange={(e) => updateStatus(conversation.phone, e.target.value)}
          >
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          {(conversation.status || "").includes("Aguardando") && (
            <button
              onClick={() => confirmAppointment(conversation)}
              className="w-full mt-2 bg-green-500/10 border border-green-500/20 text-green-300 rounded-xl py-2 text-xs"
            >
              Confirmar agendamento
            </button>
          )}
        </div>

        <div className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-zinc-400">Atendente responsável</p>
            <button
              onClick={() => autoAssignAgent(conversation.phone)}
              className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1"
            >
              Auto distribuir
            </button>
          </div>

          <select
            className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-3 text-xs"
            value={conversation.assigned_to_email || ""}
            onChange={(e) => assignAgent(conversation.phone, e.target.value)}
          >
            <option value="">Selecionar atendente</option>
            {agents.map((agent) => {
              const online = isAgentOnline(agent, onlineAgents);

              return (
                <option key={agent.email || agent.name} value={agent.email}>
                  {agent.name} {online ? "• online" : "• offline"}
                </option>
              );
            })}
          </select>

          <p className="text-[10px] text-zinc-500 mt-2">
            Atual: {conversation.assigned_to || "Admin"}
          </p>
        </div>

        {conversation.summary && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-3 mb-3">
            <p className="text-[10px] text-purple-300 mb-1">Resumo IA</p>
            <p className="text-xs text-zinc-300 leading-relaxed">{conversation.summary}</p>
          </div>
        )}

        {conversation.ai_suggestion && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 mb-3">
            <p className="text-[10px] text-blue-300 mb-1">Sugestão IA</p>
            <p className="text-xs text-zinc-300 leading-relaxed">{conversation.ai_suggestion}</p>

            <button
              onClick={() =>
                setReplyMessage((prev) => ({
                  ...prev,
                  [conversation.phone]: conversation.ai_suggestion
                }))
              }
              className="mt-3 bg-blue-500/20 text-blue-300 rounded-xl px-3 py-2 text-xs"
            >
              Usar sugestão
            </button>
          </div>
        )}

        <div className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3">
          <p className="text-[10px] text-zinc-400 mb-2">Dados do lead</p>

          <input
            className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-2 mb-2 text-xs"
            placeholder="Nome"
            defaultValue={conversation.customer_name || ""}
            onBlur={(e) =>
              updateDetails(conversation.phone, e.target.value, conversation.notes || "")
            }
          />

          <textarea
            className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-2 mb-2 text-xs h-20"
            placeholder="Observações"
            defaultValue={conversation.notes || ""}
            onBlur={(e) =>
              updateDetails(
                conversation.phone,
                conversation.customer_name || "",
                e.target.value
              )
            }
          />

          <input
            className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-2 text-xs"
            placeholder="Tags"
            defaultValue={conversation.tags || ""}
            onBlur={(e) => updateTags(conversation.phone, e.target.value)}
          />
        </div>

        <div className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3">
          <p className="text-[10px] text-zinc-400 mb-2">Timeline</p>

          <div className="space-y-1">
            <p className="text-[10px] text-zinc-300">✅ Lead criado</p>
            <p className="text-[10px] text-zinc-300">💬 Cliente respondeu</p>
            <p className="text-[10px] text-zinc-300">🤖 IA respondeu</p>
            {conversation.assigned_to && (
              <p className="text-[10px] text-blue-300">👤 Atribuído para {conversation.assigned_to}</p>
            )}
            {conversation.status === "Fechado" && (
              <p className="text-[10px] text-green-400">💰 Lead fechado</p>
            )}
          </div>
        </div>

        <div
          className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3"
          onClick={() => markAsRead(conversation.phone)}
        >
          <div className="flex justify-between items-center mb-3">
            <p className="text-[10px] text-zinc-400">Histórico completo</p>
            {typingUsers[conversation.phone] && (
              <p className="text-[10px] text-green-400 italic animate-pulse">digitando...</p>
            )}
          </div>

          <div className="h-[320px] overflow-y-auto space-y-2 pr-1">
            {conversation.history?.length ? (
              conversation.history.map((msg, index) => <MessageBubble key={index} msg={msg} />)
            ) : (
              <p className="text-xs text-zinc-500">Nenhuma mensagem ainda.</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 bg-[#050816]">
        <p className="text-[10px] text-zinc-400 mb-2">Responder WhatsApp</p>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-[#0b1023] border border-white/10 rounded-xl p-3 text-xs"
            placeholder="Digite uma resposta..."
            value={replyMessage[conversation.phone] || ""}
            onChange={(e) =>
              setReplyMessage((prev) => ({
                ...prev,
                [conversation.phone]: e.target.value
              }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendManualMessage(conversation.phone);
              }
            }}
          />

          <button
            onClick={() => sendManualMessage(conversation.phone)}
            className="bg-blue-500/20 text-blue-300 px-4 rounded-xl text-xs font-bold"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="bg-[#050816] border border-white/10 rounded-xl p-3">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className="text-xs text-purple-300 font-bold mt-1">{value}</p>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isClient = msg.role === "user";

  return (
    <div
      className={`rounded-xl p-2 text-xs border ${
        isClient ? "bg-zinc-800 border-zinc-700" : "bg-green-500/10 border-green-500/20"
      }`}
    >
      <div className="flex justify-between mb-1">
        <span className="text-[9px] text-zinc-400">{isClient ? "Cliente" : "Luna"}</span>
        <span className="text-[9px] text-zinc-500">{formatTime(msg.created_at)}</span>
      </div>

      <p>{msg.content}</p>

      {msg.type === "image" && msg.media_url && (
        <img src={`${API_URL}/api/media/${msg.media_url}`} className="mt-2 rounded-xl" alt="Mídia" />
      )}

      {msg.type === "audio" && msg.media_url && (
        <audio controls className="mt-2 w-full">
          <source src={`${API_URL}/api/media/${msg.media_url}`} />
        </audio>
      )}

      {msg.type === "document" && msg.media_url && (
        <a
          href={`${API_URL}/api/media/${msg.media_url}`}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 underline mt-2 block"
        >
          Abrir documento
        </a>
      )}
    </div>
  );
}

function FinanceCard({ title, value, subtitle }) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4 shadow-xl">
      <p className="text-xs text-zinc-400">{title}</p>
      <p className="text-2xl font-black mt-2">{value}</p>
      <p className="text-[10px] text-zinc-500 mt-2">{subtitle}</p>
    </div>
  );
}

function ChartBox({ title, children }) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4 shadow-xl">
      <h2 className="font-bold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Appointments({ appointments }) {
  return (
    <div className="mt-5 bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold">Agendamentos</h2>
        <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">{appointments.length}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {appointments.map((item) => (
          <div key={item.id} className="bg-[#111827] border border-white/10 rounded-xl p-3">
            <p className="font-bold text-sm">{item.customer_name || "Cliente"}</p>
            <p className="text-xs text-zinc-400">{item.phone}</p>
            <p className="text-xs mt-2">{item.service}</p>
            <p className="text-xs text-green-400">{item.appointment_date}</p>
            <p className="text-xs text-emerald-400 font-bold">{formatMoney(item.price)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToastArea({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-[#0b1023] border border-zinc-700 rounded-2xl px-5 py-4 shadow-2xl"
        >
          <p className="font-bold text-sm">Luna AI</p>
          <p className="text-zinc-300 text-sm">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}

export default App;
