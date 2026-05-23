import { useEffect, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { io } from "socket.io-client";
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

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

const COLORS = ["#8b5cf6", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];

const COLUMN_COLORS = {
  "Novo Lead": "border-purple-500/50 shadow-purple-500/10",
  "Em Atendimento": "border-blue-500/50 shadow-blue-500/10",
  "Aguardando Confirmação": "border-yellow-500/50 shadow-yellow-500/10",
  Fechado: "border-green-500/50 shadow-green-500/10",
  Perdido: "border-red-500/50 shadow-red-500/10"
};

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContextClass();
    const oscillator1 = audio.createOscillator();
    const oscillator2 = audio.createOscillator();
    const gain = audio.createGain();

    oscillator1.connect(gain);
    oscillator2.connect(gain);
    gain.connect(audio.destination);

    oscillator1.frequency.value = 880;
    oscillator2.frequency.value = 1320;

    gain.gain.setValueAtTime(0.18, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.45);

    oscillator1.start(audio.currentTime);
    oscillator2.start(audio.currentTime + 0.08);

    oscillator1.stop(audio.currentTime + 0.35);
    oscillator2.stop(audio.currentTime + 0.45);
  } catch (error) {
    console.log("Som bloqueado:", error.message);
  }
}

function formatTime(date) {
  if (!date) return "agora";

  return new Date(date).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR"
  });
}

function getInitials(name, phone) {
  const value = (name || phone || "Cliente").trim();

  if (!value) return "C";

  return value
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getLastMessage(conversation) {
  const history = conversation.history || [];
  return history[history.length - 1]?.content || "Sem mensagens";
}

function getLastMessageTime(conversation) {
  const history = conversation.history || [];
  return formatTime(history[history.length - 1]?.created_at);
}

function isRecentConversation(conversation) {
  const history = conversation.history || [];
  const last = history[history.length - 1]?.created_at;

  if (!last) return false;

  const minutes = (Date.now() - new Date(last).getTime()) / 1000 / 60;
  return minutes <= 10;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const current = payload[0];

  return (
    <div className="bg-[#050816] border border-zinc-700 rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-xs text-zinc-400">{label || current?.name || "Valor"}</p>
      <p className="text-sm font-bold text-white">
        {current?.dataKey === "value"
          ? formatMoney(current?.value)
          : current?.value}
      </p>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("luna_admin");
    return saved ? JSON.parse(saved) : null;
  });

  const [email, setEmail] = useState(localStorage.getItem("saved_email") || "");
  const [password, setPassword] = useState(
    localStorage.getItem("saved_password") || ""
  );
  const [remember, setRemember] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [replyMessage, setReplyMessage] = useState({});
  const [toasts, setToasts] = useState([]);
  const [search, setSearch] = useState("");
  const [typingPhones, setTypingPhones] = useState({});
  const [socketConnected, setSocketConnected] = useState(false);

  const lastMessageCountRef = useRef(0);
  const hasInteractedRef = useRef(false);
  const socketRef = useRef(null);

  const totalRevenue = appointments.reduce((total, item) => {
    return total + Number(item.price || 0);
  }, 0);

  const averageTicket =
    appointments.length > 0 ? totalRevenue / appointments.length : 0;

  const closedLeads = conversations.filter(
    (item) => item.status === "Fechado"
  ).length;

  const totalMessages = conversations.reduce((total, item) => {
    return total + (item.history?.length || 0);
  }, 0);

  const statusData = STATUS_OPTIONS.map((status) => ({
    name: status.replace("Aguardando Confirmação", "Confirmação"),
    total: conversations.filter(
      (item) => (item.status || "Novo Lead") === status
    ).length
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
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }

  function notifyDesktop(title, body) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }

  function login(e) {
    e.preventDefault();

    if (
      email.trim().toLowerCase() === "bruno.coop32@icloud.com" &&
      password.trim() === "jaftYw-nirke9-dibsab"
    ) {
      const adminSession = { user: { email: "bruno.coop32@icloud.com" } };

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

    alert("Email ou senha incorretos");
  }

  function logout() {
    localStorage.removeItem("luna_admin");
    setSession(null);
  }

  async function loadConversations(options = {}) {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();

      setConversations(data);

      const currentTotalMessages = data.reduce((total, conversation) => {
        return total + (conversation.history?.length || 0);
      }, 0);

      if (
        !options.silent &&
        lastMessageCountRef.current !== 0 &&
        currentTotalMessages > lastMessageCountRef.current
      ) {
        if (hasInteractedRef.current) {
          playBeep();
        }

        addToast("Nova mensagem recebida");
        notifyDesktop("Luna AI CRM", "Nova mensagem recebida.");
      }

      lastMessageCountRef.current = currentTotalMessages;
    } catch (error) {
      console.error(error);
    }
  }

  async function loadAppointments() {
    try {
      const response = await fetch(`${API_URL}/api/appointments`);
      const data = await response.json();
      setAppointments(data);
    } catch (error) {
      console.error(error);
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
      body: JSON.stringify({
        phone,
        customer_name,
        notes
      })
    });

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
        customer_name: conversation.customer_name || "Cliente",
        phone: conversation.phone,
        service,
        appointment_date: appointmentDate,
        price
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao confirmar");
      return;
    }

    addToast("Agendamento confirmado");
    await loadConversations({ silent: true });
    await loadAppointments();
  }

  async function sendManualMessage(phone) {
    const message = replyMessage[phone];

    if (!message?.trim()) return;

    const response = await fetch(`${API_URL}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone,
        message
      })
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

  async function sendFollowUp(phone) {
    const response = await fetch(`${API_URL}/api/follow-up`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao enviar follow-up");
      return;
    }

    addToast("Follow-up enviado");
    await loadConversations({ silent: true });
  }

  async function handleDragEnd(result) {
    if (!result.destination) return;

    const phone = result.draggableId;
    const newStatus = result.destination.droppableId;

    await updateStatus(phone, newStatus);
    addToast("Lead movido");
  }

  useEffect(() => {
    if (!session) return;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    loadConversations({ silent: true });
    loadAppointments();

    const socket = io(API_URL, {
      transports: ["websocket", "polling"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      addToast("Tempo real conectado");
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
      addToast("Tempo real desconectado");
    });

    socket.on("new_message", (data) => {
      if (hasInteractedRef.current) {
        playBeep();
      }

      addToast(`Nova mensagem: ${data.phone}`);
      notifyDesktop("Luna AI CRM", `Nova mensagem de ${data.phone}`);
      loadConversations({ silent: true });
    });

    socket.on("conversation_updated", () => {
      loadConversations({ silent: true });
    });

    socket.on("conversation_summary", () => {
      loadConversations({ silent: true });
    });

    socket.on("appointment_confirmed", () => {
      loadConversations({ silent: true });
      loadAppointments();
      addToast("Agenda atualizada");
    });

    socket.on("typing", (data) => {
      setTypingPhones((prev) => ({
        ...prev,
        [data.phone]: data.typing
      }));
    });

    const fallbackInterval = setInterval(() => {
      if (!socket.connected) {
        loadConversations({ silent: true });
        loadAppointments();
      }
    }, 8000);

    return () => {
      clearInterval(fallbackInterval);
      socket.disconnect();
    };
  }, [session]);

  if (!session) {
    return (
      <div className="min-h-screen bg-[#050816] text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-[#0b1023] p-8 rounded-3xl w-full max-w-sm border border-zinc-800 shadow-2xl"
        >
          <h1 className="text-2xl font-black mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Luna AI
          </h1>

          <p className="text-zinc-400 text-sm mb-6">Painel administrativo</p>

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
        hasInteractedRef.current = true;
      }}
    >
      <ToastArea toasts={toasts} />

      <div className="max-w-[1900px] mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <span className="text-2xl">☾</span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                Luna AI CRM
              </h1>

              <div className="flex items-center gap-2">
                <p className="text-zinc-400 text-sm">{session.user.email}</p>
                <span
                  className={`w-2 h-2 rounded-full ${
                    socketConnected ? "bg-green-400" : "bg-red-400"
                  }`}
                />
                <span className="text-xs text-zinc-500">
                  {socketConnected ? "Realtime ativo" : "Fallback ativo"}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-400 px-5 py-3 rounded-2xl text-sm font-bold"
          >
            Sair
          </button>
        </div>

        <div className="mb-4 grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
          <input
            type="text"
            placeholder="Buscar lead por nome, telefone ou observação..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 text-sm outline-none focus:border-purple-500"
          />

          <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-400 flex items-center justify-between">
            <span>Mensagens</span>
            <strong className="text-white">{totalMessages}</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <FinanceCard
            title="Faturamento"
            value={formatMoney(totalRevenue)}
            description="Total confirmado"
            icon="€"
            color="border-purple-500/60 shadow-purple-500/20"
            iconColor="bg-purple-500/20 text-purple-300"
          />

          <FinanceCard
            title="Agendamentos"
            value={appointments.length}
            description="Total de agendamentos"
            icon="📅"
            color="border-green-500/60 shadow-green-500/20"
            iconColor="bg-green-500/20 text-green-300"
          />

          <FinanceCard
            title="Ticket Médio"
            value={formatMoney(averageTicket)}
            description="Média por agendamento"
            icon="🛒"
            color="border-blue-500/60 shadow-blue-500/20"
            iconColor="bg-blue-500/20 text-blue-300"
          />

          <FinanceCard
            title="Fechados"
            value={closedLeads}
            description="Negócios fechados"
            icon="✓"
            color="border-yellow-500/60 shadow-yellow-500/20"
            iconColor="bg-yellow-500/20 text-yellow-300"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
          <DashboardChart title="Leads por Status" icon="▮">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={statusData}
                margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#263244" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#d4d4d8", fontSize: 12 }}
                  axisLine={{ stroke: "#334155" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#d4d4d8", fontSize: 12 }}
                  axisLine={{ stroke: "#334155" }}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                  {statusData.map((entry, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </DashboardChart>

          <DashboardChart title="Faturamento por Agendamento" icon="◕">
            {revenueData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={revenueData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={82}
                      innerRadius={42}
                      paddingAngle={3}
                    >
                      {revenueData.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="space-y-3">
                  {revenueData.slice(0, 5).map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: COLORS[index % COLORS.length]
                          }}
                        />
                        <span className="truncate">{item.name}</span>
                      </div>

                      <span className="text-zinc-300 ml-2">
                        {formatMoney(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-zinc-500 text-sm">
                Nenhum valor registrado ainda
              </div>
            )}
          </DashboardChart>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
            {STATUS_OPTIONS.map((status) => (
              <Column
                key={status}
                status={status}
                conversations={conversations}
                updateStatus={updateStatus}
                updateDetails={updateDetails}
                confirmAppointment={confirmAppointment}
                replyMessage={replyMessage}
                setReplyMessage={setReplyMessage}
                sendManualMessage={sendManualMessage}
                sendFollowUp={sendFollowUp}
                search={search}
                typingPhones={typingPhones}
              />
            ))}
          </div>
        </DragDropContext>

        <Appointments appointments={appointments} />
      </div>
    </div>
  );
}

function Column({
  status,
  conversations,
  search,
  typingUsers,
  updateStatus,
  updateDetails,
  updateTags,
  sendManualMessage,
  replyMessage,
  setReplyMessage,
  followUp,
  generateSuggestion,
  markAsRead
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
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className="bg-[#0b1023] border border-zinc-800 rounded-3xl h-[520px] overflow-hidden"
        >
          <div className="flex justify-between items-center p-4 border-b border-white/10">
            <h2 className="font-bold">{status}</h2>

            <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">
              {filtered.length}
            </span>
          </div>

          <div className="h-[450px] overflow-y-auto p-3 space-y-3">
            {filtered.map((conversation, index) => (
              <Draggable
                key={conversation.phone}
                draggableId={conversation.phone}
                index={index}
              >
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className="bg-[#111827] border border-white/10 rounded-2xl p-3"
                  >
                    <div
                      {...provided.dragHandleProps}
                      className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar conversation={conversation} />

                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">
                            {conversation.customer_name ||
                              conversation.profile_name ||
                              "Cliente"}
                          </p>

                          <p className="text-[10px] text-zinc-400 truncate">
                            {conversation.phone}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />

                        <span className="bg-purple-500/20 text-purple-300 text-[10px] px-2 py-1 rounded-lg">
                          {conversation.unread_count || 0}
                        </span>
                      </div>
                    </div>

                    <div className="mb-2">
                      <p className="text-xs text-zinc-400">Última mensagem</p>

                      <p className="text-xs truncate">
                        {getLastMessage(conversation)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-red-500/20 text-red-300">
                        🔴 Quente
                      </span>

                      <span className="text-[10px] text-zinc-500">
                        Alta conversão
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        onClick={() => followUp(conversation.phone)}
                        className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-lg py-2 text-xs"
                      >
                        Follow-up
                      </button>

                      <button
                        onClick={() => generateSuggestion(conversation.phone)}
                        className="bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-lg py-2 text-xs"
                      >
                        IA
                      </button>
                    </div>

                    <select
                      className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-3 text-xs"
                      value={conversation.status || "Novo Lead"}
                      onChange={(e) =>
                        updateStatus(conversation.phone, e.target.value)
                      }
                    >
                      {STATUS_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>

                    <details className="bg-[#050816] border border-white/10 rounded-xl p-2">
                      <summary className="cursor-pointer text-xs text-purple-300 select-none">
                        Abrir acompanhamento
                      </summary>

                      <div className="mt-3">
                        {conversation.summary && (
                          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-2 mb-2">
                            <p className="text-[10px] text-purple-300">
                              Resumo IA
                            </p>

                            <p className="text-[11px] text-zinc-300">
                              {conversation.summary}
                            </p>
                          </div>
                        )}

                        {conversation.ai_suggestion && (
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2 mb-2">
                            <p className="text-[10px] text-blue-300">
                              Sugestão IA
                            </p>

                            <p className="text-[11px] text-zinc-300">
                              {conversation.ai_suggestion}
                            </p>
                          </div>
                        )}

                        <div className="mb-2 bg-[#050816] border border-white/10 rounded-lg p-2">
                          <p className="text-[10px] text-zinc-400">
                            Responsável
                          </p>

                          <p className="text-xs text-purple-300 font-bold">
                            Admin
                          </p>
                        </div>

                        <input
                          className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs"
                          placeholder="Nome"
                          defaultValue={conversation.customer_name || ""}
                          onBlur={(e) =>
                            updateDetails(
                              conversation.phone,
                              e.target.value,
                              conversation.notes || ""
                            )
                          }
                        />

                        <textarea
                          className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs h-16"
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
                          className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs"
                          placeholder="Tags"
                          defaultValue={conversation.tags || ""}
                          onBlur={(e) =>
                            updateTags(conversation.phone, e.target.value)
                          }
                        />

                        <div className="bg-[#050816] border border-white/10 rounded-xl p-2 mb-2">
                          <p className="text-[10px] text-zinc-400 mb-2">
                            Timeline
                          </p>

                          <div className="space-y-1">
                            <p className="text-[10px] text-zinc-300">
                              ✅ Lead criado
                            </p>

                            <p className="text-[10px] text-zinc-300">
                              💬 Cliente respondeu
                            </p>

                            <p className="text-[10px] text-zinc-300">
                              🤖 IA respondeu
                            </p>

                            {conversation.status === "Fechado" && (
                              <p className="text-[10px] text-green-400">
                                💰 Lead fechado
                              </p>
                            )}
                          </div>
                        </div>

                        <div
                          className="h-28 overflow-y-auto border-t border-white/10 pt-2 space-y-2"
                          onClick={() => markAsRead(conversation.phone)}
                        >
                          {conversation.history?.slice(-8).map((msg, index) => (
                            <MessageBubble key={index} msg={msg} />
                          ))}

                          {typingUsers[conversation.phone] && (
                            <div className="text-[10px] text-zinc-500 italic">
                              digitando...
                            </div>
                          )}
                        </div>

                        <div className="mt-2 flex gap-2">
                          <input
                            className="flex-1 bg-[#050816] border border-white/10 rounded-lg p-2 text-xs"
                            placeholder="Responder..."
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
                            className="bg-blue-500/20 text-blue-300 px-3 rounded-lg text-xs"
                          >
                            Enviar
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </Draggable>
            ))}

            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}

function MessageBubble({ msg }) {
  const isClient = msg.role === "user";

  return (
    <div
      className={`rounded-xl p-2 text-xs border ${
        isClient
          ? "bg-zinc-800 border-zinc-700"
          : "bg-green-500/20 border-green-500/20"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
              isClient
                ? "bg-blue-500/30 text-blue-300"
                : "bg-green-500/30 text-green-300"
            }`}
          >
            {isClient ? "C" : "IA"}
          </div>

          <p className="text-[9px] text-zinc-400">
            {isClient ? "Cliente" : "Luna IA"}
          </p>
        </div>

        <p className="text-[9px] text-zinc-500">
          {formatTime(msg.created_at)}
        </p>
      </div>

      <p>{msg.content}</p>

      {msg.type && msg.type !== "text" && (
        <p className="text-[10px] text-purple-300 mt-1">
          Mídia recebida: {msg.type}
        </p>
      )}
    </div>
  );
}

function FinanceCard({ title, value, description, icon, color, iconColor }) {
  return (
    <div
      className={`relative overflow-hidden bg-[#0b1023] border ${color} rounded-2xl p-4 shadow-2xl`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-20" />

      <div className="relative z-10 flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-300 mb-2">{title}</p>
          <p className="text-2xl font-black">{value}</p>
          <p className="text-sm text-zinc-400 mt-3">{description}</p>
        </div>

        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center text-2xl ${iconColor}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function DashboardChart({ title, icon, children }) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4 h-[260px] shadow-2xl">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-purple-400">{icon}</span>
        <h2 className="font-bold text-xl">{title}</h2>
      </div>

      {children}
    </div>
  );
}

function Appointments({ appointments }) {
  return (
    <div className="mt-5 bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold">Agendamentos</h2>

        <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">
          {appointments.length}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {appointments.map((item) => (
          <div
            key={item.id}
            className="bg-[#111827] border border-white/10 rounded-xl p-3"
          >
            <p className="font-bold text-sm">
              {item.customer_name || "Cliente"}
            </p>

            <p className="text-xs text-zinc-400">{item.phone}</p>

            <p className="text-xs mt-2">{item.service}</p>

            <p className="text-xs text-green-400">
              {item.appointment_date}
            </p>

            <p className="text-xs text-emerald-400 font-bold">
              {formatMoney(item.price)}
            </p>
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
          className="bg-[#0b1023] border border-zinc-700 text-white rounded-2xl px-5 py-4 shadow-2xl"
        >
          <p className="font-bold text-sm">Luna AI CRM</p>
          <p className="text-zinc-300 text-sm">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}

export default App;
