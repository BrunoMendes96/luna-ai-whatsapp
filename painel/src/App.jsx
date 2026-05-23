import { useEffect, useRef, useState } from "react";
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
    const audio = new AudioContext();
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

function getClientName(conversation) {
  return conversation.customer_name || "Cliente";
}

function getInitials(name) {
  return (name || "Cliente")
    .trim()
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getLastMessage(conversation) {
  const history = conversation.history || [];
  return history[history.length - 1];
}

function getLastMessageText(conversation) {
  return getLastMessage(conversation)?.content || "Sem mensagens ainda";
}

function isRecentlyActive(conversation) {
  const lastMessage = getLastMessage(conversation);

  if (!lastMessage?.created_at) {
    return (conversation.history || []).length > 0;
  }

  const lastTime = new Date(lastMessage.created_at).getTime();
  const diffMinutes = (Date.now() - lastTime) / 1000 / 60;

  return diffMinutes <= 30;
}

function isWaitingForAI(conversation) {
  const lastMessage = getLastMessage(conversation);
  return lastMessage?.role === "user";
}

function getConversationSummary(conversation) {
  const history = conversation.history || [];
  const lastMessages = history
    .slice(-4)
    .map((msg) => msg.content)
    .join(" ");

  if (!lastMessages) return "Sem histórico suficiente.";

  if (/agend|marcar|hor[aá]rio|dia|confirm/i.test(lastMessages)) {
    return "Cliente com intenção de agendamento.";
  }

  if (/pre[cç]o|valor|quanto|custa/i.test(lastMessages)) {
    return "Cliente perguntando sobre valores.";
  }

  if (/piercing/i.test(lastMessages)) {
    return "Interesse em piercing.";
  }

  if (/tattoo|tatuagem/i.test(lastMessages)) {
    return "Interesse em tattoo.";
  }

  if (/est[eé]tica/i.test(lastMessages)) {
    return "Interesse em estética.";
  }

  return "Conversa em atendimento.";
}

function getFollowUpSuggestion(conversation) {
  const status = conversation.status || "Novo Lead";

  if (status === "Novo Lead") {
    return "Responder rápido e puxar para agendamento.";
  }

  if (status === "Aguardando Confirmação") {
    return "Confirmar disponibilidade ou sugerir outro horário.";
  }

  if (status === "Em Atendimento") {
    return "Tirar dúvida e pedir melhor dia/horário.";
  }

  if (status === "Fechado") {
    return "Enviar lembrete antes do horário.";
  }

  return "Reativar com mensagem curta e educada.";
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const current = payload[0];

  return (
    <div className="bg-[#050816] border border-zinc-700 rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-xs text-zinc-400">
        {label || current?.name || "Valor"}
      </p>

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

  const lastMessageCountRef = useRef(0);
  const hasInteractedRef = useRef(false);

  const totalRevenue = appointments.reduce((total, item) => {
    return total + Number(item.price || 0);
  }, 0);

  const averageTicket =
    appointments.length > 0 ? totalRevenue / appointments.length : 0;

  const closedLeads = conversations.filter(
    (item) => item.status === "Fechado"
  ).length;

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

  async function loadConversations() {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();

      setConversations(data);

      const totalMessages = data.reduce((total, conversation) => {
        return total + (conversation.history?.length || 0);
      }, 0);

      if (
        lastMessageCountRef.current !== 0 &&
        totalMessages > lastMessageCountRef.current
      ) {
        if (hasInteractedRef.current) {
          playBeep();
        }

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

    await loadConversations();
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

    await loadConversations();
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
    await loadConversations();
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
    await loadConversations();
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

    loadConversations();
    loadAppointments();

    const interval = setInterval(() => {
      loadConversations();
      loadAppointments();
    }, 3000);

    return () => clearInterval(interval);
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
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <span className="text-2xl">☾</span>
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                Luna AI CRM
              </h1>

              <p className="text-zinc-400 text-sm">{session.user.email}</p>
            </div>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-400 px-5 py-3 rounded-2xl text-sm font-bold"
          >
            Sair
          </button>
        </div>

        <div className="mb-5">
          <input
            type="text"
            placeholder="Buscar lead por nome, telefone ou observação..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 text-sm outline-none focus:border-purple-500"
          />
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
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
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={3}
                      label
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
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: COLORS[index % COLORS.length]
                          }}
                        />
                        <span>{item.name}</span>
                      </div>

                      <span className="text-zinc-300">
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
                search={search}
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
  updateStatus,
  updateDetails,
  confirmAppointment,
  replyMessage,
  setReplyMessage,
  sendManualMessage,
  search
}) {
  const filtered = conversations
    .filter((item) => (item.status || "Novo Lead") === status)
    .filter((item) => {
      const text = `
        ${item.phone}
        ${item.customer_name || ""}
        ${item.notes || ""}
        ${getLastMessageText(item)}
      `.toLowerCase();

      return text.includes(search.toLowerCase());
    })
    .reverse();

  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`bg-[#0b1023] border rounded-3xl h-[430px] overflow-hidden shadow-2xl ${
            snapshot.isDraggingOver
              ? "border-purple-500 bg-purple-500/10"
              : COLUMN_COLORS[status]
          }`}
        >
          <div className="flex justify-between items-center px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">{status}</h2>
              <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">
                {filtered.length}
              </span>
            </div>

            <span className="text-xl text-zinc-300">+</span>
          </div>

          <div className="h-[345px] overflow-y-auto p-3 space-y-3">
            {filtered.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500">
                <div className="text-3xl mb-3">▱</div>
                <p className="font-bold text-sm">Nenhum lead</p>
                <p className="text-xs mt-1">Arraste leads para esta etapa</p>
              </div>
            )}

            {filtered.map((conversation, index) => (
              <Draggable
                key={conversation.phone}
                draggableId={conversation.phone}
                index={index}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className={`bg-[#111827] border border-white/10 rounded-2xl p-3 transition ${
                      snapshot.isDragging
                        ? "ring-2 ring-purple-500 scale-[1.02]"
                        : ""
                    }`}
                  >
                    <div
                      {...provided.dragHandleProps}
                      className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs font-black shadow-lg shadow-purple-500/20">
                            {getInitials(getClientName(conversation))}
                          </div>

                          <span
                            className={`absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-[#111827] ${
                              isRecentlyActive(conversation)
                                ? "bg-green-400 animate-pulse"
                                : "bg-zinc-500"
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">
                            {getClientName(conversation)}
                          </p>

                          <p className="text-[10px] text-zinc-400 truncate">
                            {conversation.phone}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isWaitingForAI(conversation) && (
                          <span className="bg-blue-500/20 text-blue-300 text-[10px] px-2 py-1 rounded-lg">
                            IA...
                          </span>
                        )}

                        <span className="bg-purple-500/30 text-purple-200 text-[10px] px-2 py-1 rounded-lg">
                          {conversation.history?.length || 0}
                        </span>
                      </div>
                    </div>

                    <input
                      className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs outline-none"
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
                      className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs h-12 outline-none"
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

                    <select
                      className="w-full bg-[#050816] border border-white/10 rounded-lg p-2 mb-2 text-xs outline-none"
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

                    {(conversation.status || "").includes("Aguardando") && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <button
                          onClick={() => confirmAppointment(conversation)}
                          className="bg-green-500/20 text-green-400 rounded-lg p-2 text-xs"
                        >
                          Confirmar
                        </button>

                        <button
                          onClick={() =>
                            updateStatus(conversation.phone, "Perdido")
                          }
                          className="bg-red-500/20 text-red-400 rounded-lg p-2 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    <div className="mb-2 rounded-xl bg-[#050816]/80 border border-white/10 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-[10px] text-zinc-400">
                          Última mensagem
                        </p>

                        <p className="text-[10px] text-zinc-500">
                          {formatTime(getLastMessage(conversation)?.created_at)}
                        </p>
                      </div>

                      <p className="text-xs text-white truncate">
                        {getLastMessageText(conversation)}
                      </p>
                    </div>

                    <div className="mb-2 grid grid-cols-1 gap-2">
                      <div className="rounded-xl bg-purple-500/10 border border-purple-500/20 p-2">
                        <p className="text-[10px] text-purple-300 font-bold mb-1">
                          Resumo IA
                        </p>

                        <p className="text-[11px] text-zinc-300">
                          {getConversationSummary(conversation)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2">
                        <p className="text-[10px] text-blue-300 font-bold mb-1">
                          Follow-up
                        </p>

                        <p className="text-[11px] text-zinc-300">
                          {getFollowUpSuggestion(conversation)}
                        </p>
                      </div>
                    </div>

                    <div className="h-28 overflow-y-auto space-y-2 pr-1 border-t border-white/10 pt-2">
                      {[...(conversation.history || [])]
                        .reverse()
                        .map((msg, index) => (
                          <MessageBubble key={index} msg={msg} />
                        ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 bg-[#050816] border border-white/10 rounded-lg p-2 text-xs outline-none"
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
                        className="bg-blue-500/20 text-blue-400 px-3 rounded-lg text-xs"
                      >
                        Enviar
                      </button>
                    </div>
                  </div>
                )}
              </Draggable>
            ))}

            {provided.placeholder}
          </div>

          <div className="border-t border-white/10 px-4 py-2 text-sm text-zinc-400">
            {filtered.length} {filtered.length === 1 ? "lead" : "leads"}
          </div>
        </div>
      )}
    </Droppable>
  );
}

function Appointments({ appointments }) {
  return (
    <div className="mt-5 bg-[#0b1023] border border-zinc-800 rounded-2xl p-4 shadow-2xl">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-bold">Agendamentos Confirmados</h2>

        <span className="bg-white/10 px-2 py-1 rounded-lg text-xs">
          {appointments.length}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {appointments.map((item) => (
          <div
            key={item.id}
            className="bg-[#111827] rounded-xl p-3 border border-white/10"
          >
            <p className="font-bold text-sm">
              {item.customer_name || "Cliente"}
            </p>
            <p className="text-xs text-zinc-400">{item.phone}</p>
            <p className="text-xs mt-2">{item.service}</p>
            <p className="text-xs text-green-400">{item.appointment_date}</p>
            <p className="text-xs text-emerald-400 font-bold">
              {formatMoney(item.price)}
            </p>
          </div>
        ))}
      </div>
    </div>
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
