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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-400">{label || "Valor"}</p>
      <p className="text-sm font-bold text-white">
        {payload[0]?.dataKey === "value"
          ? formatMoney(payload[0]?.value)
          : payload[0]?.value}
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
      name: item.customer_name || `Agendamento ${index + 1}`,
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
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-zinc-900/80 p-8 rounded-3xl w-full max-w-sm border border-zinc-800 shadow-2xl"
        >
          <h1 className="text-3xl font-bold mb-2">Luna AI</h1>
          <p className="text-zinc-400 text-sm mb-6">Painel administrativo</p>

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-3 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-4 outline-none"
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
      className="min-h-screen bg-black text-white p-4"
      onClick={() => {
        hasInteractedRef.current = true;
      }}
    >
      <ToastArea toasts={toasts} />

      <div className="max-w-[1900px] mx-auto">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Luna AI CRM</h1>
            <p className="text-zinc-400 text-sm mt-1">{session.user.email}</p>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-2 rounded-xl text-sm"
          >
            Sair
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <FinanceCard
            title="Faturamento"
            value={formatMoney(totalRevenue)}
            color="border-purple-500/40 shadow-purple-500/10"
          />

          <FinanceCard
            title="Agendamentos"
            value={appointments.length}
            color="border-green-500/40 shadow-green-500/10"
          />

          <FinanceCard
            title="Ticket Médio"
            value={formatMoney(averageTicket)}
            color="border-blue-500/40 shadow-blue-500/10"
          />

          <FinanceCard
            title="Fechados"
            value={closedLeads}
            color="border-yellow-500/40 shadow-yellow-500/10"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
          <DashboardChart title="Leads por Status">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </DashboardChart>

          <DashboardChart title="Faturamento">
            {revenueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={revenueData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={85}
                    innerRadius={45}
                    paddingAngle={4}
                  >
                    {revenueData.map((entry, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[230px] flex items-center justify-center text-zinc-500 text-sm">
                Nenhum valor registrado ainda
              </div>
            )}
          </DashboardChart>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
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
              />
            ))}

            <Appointments appointments={appointments} />
          </div>
        </DragDropContext>
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
  sendManualMessage
}) {
  const filtered = conversations
    .filter((item) => (item.status || "Novo Lead") === status)
    .reverse();

  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`bg-zinc-900/80 border rounded-2xl p-3 h-[660px] overflow-y-auto transition ${
            snapshot.isDraggingOver
              ? "border-purple-500 bg-purple-500/10"
              : "border-zinc-800"
          }`}
        >
          <div className="flex justify-between items-center mb-3 sticky top-0 bg-zinc-900/95 pb-2 z-10">
            <h2 className="text-base font-bold">{status}</h2>
            <span className="bg-zinc-800 px-2 py-1 rounded-lg text-xs">
              {filtered.length}
            </span>
          </div>

          <div className="space-y-3">
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
                    className={`bg-zinc-800/90 rounded-2xl p-3 transition ${
                      snapshot.isDragging
                        ? "ring-2 ring-purple-500 scale-[1.02]"
                        : ""
                    }`}
                  >
                    <div
                      {...provided.dragHandleProps}
                      className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing"
                    >
                      <p className="font-bold text-sm">{conversation.phone}</p>

                      {(conversation.status || "Novo Lead") === "Novo Lead" && (
                        <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-1 rounded-full">
                          NOVO
                        </span>
                      )}
                    </div>

                    <input
                      className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-xs outline-none"
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
                      className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-xs h-12 outline-none"
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
                      className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-xs outline-none"
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

                    <div className="h-52 overflow-y-auto space-y-2 pr-1 border-t border-zinc-700 pt-2">
                      {[...(conversation.history || [])]
                        .reverse()
                        .map((msg, index) => (
                          <MessageBubble key={index} msg={msg} />
                        ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 bg-zinc-900 rounded-lg p-2 text-xs outline-none"
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
        </div>
      )}
    </Droppable>
  );
}

function Appointments({ appointments }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-3 h-[660px] overflow-y-auto">
      <div className="flex justify-between items-center mb-3 sticky top-0 bg-zinc-900/95 pb-2 z-10">
        <h2 className="text-base font-bold">Agendamentos</h2>
        <span className="bg-zinc-800 px-2 py-1 rounded-lg text-xs">
          {appointments.length}
        </span>
      </div>

      <div className="space-y-3">
        {appointments.map((item) => (
          <div key={item.id} className="bg-zinc-800/90 rounded-xl p-3">
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
          ? "bg-zinc-700 border-zinc-600"
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

function FinanceCard({ title, value, color }) {
  return (
    <div
      className={`bg-zinc-900/80 border ${color} rounded-3xl p-5 shadow-2xl`}
    >
      <p className="text-xs text-zinc-400">{title}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
    </div>
  );
}

function DashboardChart({ title, children }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-5 h-[320px]">
      <h2 className="font-bold mb-3">{title}</h2>
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
          className="bg-zinc-900 border border-zinc-700 text-white rounded-2xl px-5 py-4 shadow-2xl"
        >
          <p className="font-bold text-sm">Luna AI CRM</p>
          <p className="text-zinc-300 text-sm">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}

export default App;