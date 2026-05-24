import { useEffect, useRef, useState } from "react";
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

const socket = io(API_URL);

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

const COLORS = [
  "#8b5cf6",
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444"
];

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

function playBeep() {
  try {
    const audio = new AudioContext();

    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 920;

    oscillator.connect(gain);
    gain.connect(audio.destination);

    gain.gain.setValueAtTime(0.15, audio.currentTime);

    oscillator.start();

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audio.currentTime + 0.5
    );

    oscillator.stop(audio.currentTime + 0.5);
  } catch (error) {
    console.log(error);
  }
}

function getLastMessage(conversation) {
  if (!conversation.history?.length) {
    return "Sem mensagens";
  }

  return conversation.history[
    conversation.history.length - 1
  ]?.content;
}

function Avatar({ conversation }) {
  const customPhoto = localStorage.getItem(
    `avatar_${conversation.phone}`
  );

  if (customPhoto) {
    return (
      <img
        src={customPhoto}
        className="w-10 h-10 rounded-full object-cover"
      />
    );
  }

  const firstLetter = (
    conversation.customer_name ||
    conversation.profile_name ||
    "C"
  )
    .charAt(0)
    .toUpperCase();

  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-bold">
      {firstLetter}
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("luna_admin");
    return saved ? JSON.parse(saved) : null;
  });

  const [email, setEmail] = useState(
    localStorage.getItem("saved_email") || ""
  );

  const [password, setPassword] = useState(
    localStorage.getItem("saved_password") || ""
  );

  const [remember, setRemember] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [replyMessage, setReplyMessage] = useState({});
  const [search, setSearch] = useState("");
  const [typingUsers, setTypingUsers] = useState({});
  const [toasts, setToasts] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [agents] = useState(["Admin", "Atendente 1", "Atendente 2"]);

  const interactedRef = useRef(false);

  function addToast(message) {
    const id = Date.now();

    setToasts((prev) => [
      ...prev,
      {
        id,
        message
      }
    ]);

    setTimeout(() => {
      setToasts((prev) =>
        prev.filter((item) => item.id !== id)
      );
    }, 3000);
  }

  async function loadConversations() {
    const response = await fetch(
      `${API_URL}/api/conversations`
    );

    const data = await response.json();

    setConversations(data);
  }

  async function loadAppointments() {
    const response = await fetch(
      `${API_URL}/api/appointments`
    );

    const data = await response.json();

    setAppointments(data);
  }

  async function sendManualMessage(phone) {
    const message = replyMessage[phone];

    if (!message?.trim()) return;

    await fetch(`${API_URL}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone,
        message
      })
    });

    setReplyMessage((prev) => ({
      ...prev,
      [phone]: ""
    }));
  }

  async function updateStatus(phone, status) {
    await fetch(
      `${API_URL}/api/conversations/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          status
        })
      }
    );
  }

  async function updateDetails(
    phone,
    customer_name,
    notes
  ) {
    await fetch(
      `${API_URL}/api/conversations/details`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          customer_name,
          notes
        })
      }
    );
  }

  async function updateTags(phone, tags) {
    await fetch(
      `${API_URL}/api/conversations/tags`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          tags
        })
      }
    );
  }

  async function generateSuggestion(phone) {
    await fetch(`${API_URL}/api/ai-suggestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone
      })
    });

    addToast("Sugestão IA gerada");
  }

  async function followUp(phone) {
    await fetch(`${API_URL}/api/follow-up`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone
      })
    });

    addToast("Follow-up enviado");
  }

  async function markAsRead(phone) {
    await fetch(
      `${API_URL}/api/conversations/read`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone
        })
      }
    );
  }

  async function handleDragEnd(result) {
    if (!result.destination) return;

    await updateStatus(
      result.draggableId,
      result.destination.droppableId
    );
  }

  function login(e) {
    e.preventDefault();

    if (
      email.trim().toLowerCase() ===
        "bruno.coop32@icloud.com" &&
      password.trim() ===
        "jaftYw-nirke9-dibsab"
    ) {
      const adminSession = {
        user: {
          email
        }
      };

      localStorage.setItem(
        "luna_admin",
        JSON.stringify(adminSession)
      );

      if (remember) {
        localStorage.setItem(
          "saved_email",
          email
        );

        localStorage.setItem(
          "saved_password",
          password
        );
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

    loadConversations();
    loadAppointments();

    socket.emit("panel_online", {
      user: session.user.email
    });

    socket.on("connect", () => {
      socket.emit("panel_online", {
        user: session.user.email
      });
    });

    socket.on("new_message", () => {
      loadConversations();

      if (interactedRef.current) {
        playBeep();
      }

      addToast("Nova mensagem recebida");
    });

    socket.on("conversation_updated", () => {
      loadConversations();
    });

    socket.on("appointment_confirmed", () => {
      loadAppointments();
      loadConversations();
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

    socket.on("online_agents", () => {
      // preparado para multi atendentes em tempo real
    });

    socket.on("lead_selected", () => {
      // evento preparado para supervisão de atendimento
    });

    socket.on("conversation_summary", () => {
      loadConversations();
    });

    socket.on("ai_suggestion", () => {
      loadConversations();
    });

    return () => {
      socket.off("new_message");
      socket.off("conversation_updated");
      socket.off("appointment_confirmed");
      socket.off("typing");
      socket.off("online_users");
      socket.off("online_agents");
      socket.off("lead_selected");
      socket.off("connect");
      socket.off("conversation_summary");
      socket.off("ai_suggestion");
    };
  }, [session]);

  const totalRevenue = appointments.reduce(
    (acc, item) => {
      return acc + Number(item.price || 0);
    },
    0
  );

  const averageTicket =
    appointments.length > 0
      ? totalRevenue / appointments.length
      : 0;

  const closedLeads = conversations.filter(
    (item) => item.status === "Fechado"
  ).length;

  const statusData = STATUS_OPTIONS.map(
    (status) => ({
      name: status,
      total: conversations.filter(
        (item) =>
          (item.status || "Novo Lead") === status
      ).length
    })
  );

  const revenueData = appointments.map(
    (item, index) => ({
      name: `#${index + 1}`,
      value: Number(item.price || 0)
    })
  );

  const activeConversation = selectedConversation
    ? conversations.find((item) => item.phone === selectedConversation.phone) || selectedConversation
    : null;

  if (!session) {
    return (
      <div className="min-h-screen bg-[#050816] text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-[#0b1023] p-8 rounded-3xl w-full max-w-sm border border-zinc-800"
        >
          <h1 className="text-3xl font-black mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Luna AI
          </h1>

          <p className="text-zinc-400 text-sm mb-6">
            Painel Enterprise
          </p>

          <input
            className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl mb-3 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <input
            className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl mb-4 outline-none"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />

          <label className="flex items-center gap-2 mb-5 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) =>
                setRemember(e.target.checked)
              }
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
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-3xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              Luna AI Enterprise
            </h1>

            <p className="text-zinc-400 text-sm">
              {session.user.email}
            </p>
            <p className="text-xs text-purple-300 mt-1">
  Empresa: Luna Studio • Atendente: Admin
</p>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/10 border border-red-500/40 text-red-400 px-4 py-2 rounded-xl"
          >
            Sair
          </button>
        </div>

        <div className="mb-5">
          <input
            type="text"
            placeholder="Buscar lead..."
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="w-full bg-[#0b1023] border border-zinc-800 rounded-2xl px-4 py-3 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <FinanceCard
            title="Faturamento"
            value={formatMoney(totalRevenue)}
          />

          <FinanceCard
            title="Agendamentos"
            value={appointments.length}
          />

          <FinanceCard
            title="Ticket Médio"
            value={formatMoney(averageTicket)}
          />

          <FinanceCard
            title="Fechados"
            value={closedLeads}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">

  <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
    <p className="text-xs text-zinc-400">
      Conversão
    </p>

    <p className="text-2xl font-black mt-2 text-green-400">
      68%
    </p>
  </div>

  <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
    <p className="text-xs text-zinc-400">
      Leads Ativos
    </p>

    <p className="text-2xl font-black mt-2 text-blue-400">
      {conversations.length}
    </p>
  </div>

  <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
    <p className="text-xs text-zinc-400">
      Receita Hoje
    </p>

    <p className="text-2xl font-black mt-2 text-emerald-400">
      {formatMoney(totalRevenue / 30)}
    </p>
  </div>

  <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
    <p className="text-xs text-zinc-400">
      Tempo Resposta
    </p>

    <p className="text-2xl font-black mt-2 text-yellow-400">
      1.2m
    </p>
  </div>

  <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
    <p className="text-xs text-zinc-400">
      Performance IA
    </p>

    <p className="text-2xl font-black mt-2 text-purple-400">
      94%
    </p>
  </div>

</div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
          <ChartBox title="Leads por Status">
            <ResponsiveContainer
              width="100%"
              height={220}
            >
              <BarChart data={statusData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#222"
                />

                <XAxis
                  dataKey="name"
                  tick={{
                    fill: "#999",
                    fontSize: 10
                  }}
                />

                <YAxis
                  tick={{
                    fill: "#999",
                    fontSize: 10
                  }}
                />

                <Tooltip />

                <Bar dataKey="total">
                  {statusData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={
                        COLORS[
                          index % COLORS.length
                        ]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>

          <ChartBox title="Faturamento">
            <ResponsiveContainer
              width="100%"
              height={220}
            >
              <PieChart>
                <Pie
                  data={revenueData}
                  dataKey="value"
                  outerRadius={90}
                  label
                >
                  {revenueData.map(
                    (entry, index) => (
                      <Cell
                        key={index}
                        fill={
                          COLORS[
                            index % COLORS.length
                          ]
                        }
                      />
                    )
                  )}
                </Pie>

                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 2xl:grid-cols-[1fr_430px] gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              {STATUS_OPTIONS.map((status) => (
                <Column
                  key={status}
                  status={status}
                  conversations={conversations}
                  search={search}
                  typingUsers={typingUsers}
                  updateStatus={updateStatus}
                  updateDetails={updateDetails}
                  updateTags={updateTags}
                  sendManualMessage={sendManualMessage}
                  replyMessage={replyMessage}
                  setReplyMessage={setReplyMessage}
                  followUp={followUp}
                  generateSuggestion={generateSuggestion}
                  markAsRead={markAsRead}
                  selectedConversation={activeConversation}
                  setSelectedConversation={setSelectedConversation}
                />
              ))}
            </div>

            <LeadPanel
              conversation={activeConversation}
              typingUsers={typingUsers}
              onlineUsers={onlineUsers}
              agents={agents}
              updateStatus={updateStatus}
              updateDetails={updateDetails}
              updateTags={updateTags}
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

        <Appointments
          appointments={appointments}
        />
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
  markAsRead,
  selectedConversation,
  setSelectedConversation
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
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`bg-[#0b1023] border rounded-3xl h-[520px] overflow-hidden transition ${
            snapshot.isDraggingOver
              ? "border-purple-500 bg-purple-500/10"
              : "border-zinc-800"
          }`}
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
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    onClick={() => {
                      setSelectedConversation(conversation);
                      socket.emit("lead_opened", {
                        phone: conversation.phone
                      });
                    }}
                    className={`bg-[#111827] border rounded-2xl p-3 transition cursor-pointer ${
                      selectedConversation?.phone === conversation.phone
                        ? "border-purple-500 ring-2 ring-purple-500/30 shadow-lg shadow-purple-500/10"
                        : "border-white/10"
                    } ${
                      snapshot.isDragging ? "ring-2 ring-purple-500 scale-[1.02]" : ""
                    }`}
                  >
                    <div
                      {...provided.dragHandleProps}
                      className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar conversation={conversation} />

                        <div>
                          <p className="font-bold text-sm">
                            {conversation.customer_name ||
                              conversation.profile_name ||
                              "Cliente"}
                          </p>

                          <p className="text-[10px] text-zinc-400">
                            {conversation.phone}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
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
                      <summary className="cursor-pointer text-xs text-purple-300">
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


function LeadPanel({
  conversation,
  typingUsers,
  onlineUsers,
  agents,
  updateStatus,
  updateDetails,
  updateTags,
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
      <div className="bg-[#0b1023] border border-zinc-800 rounded-3xl p-6 min-h-[520px] 2xl:sticky 2xl:top-4 hidden 2xl:flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✨</span>
          </div>

          <h2 className="font-black text-xl mb-2">Selecione um lead</h2>

          <p className="text-sm text-zinc-400 max-w-xs">
            Clique em qualquer card do Kanban para abrir o atendimento completo,
            histórico, IA, tags e observações aqui.
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
              <h2 className="font-black text-lg truncate">
                {conversation.customer_name ||
                  conversation.profile_name ||
                  "Cliente"}
              </h2>

              <p className="text-xs text-zinc-400 truncate">
                {conversation.phone}
              </p>

              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOnline ? "bg-green-400" : "bg-zinc-500"
                  }`}
                />
                <span className="text-[10px] text-zinc-400">
                  {isOnline ? "Online agora" : "Offline"}
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

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => followUp(conversation.phone)}
            className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-xl py-2 text-xs"
          >
            Follow-up
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
          <div className="bg-[#050816] border border-white/10 rounded-xl p-3">
            <p className="text-[10px] text-zinc-400">Prioridade</p>
            <p className="text-xs text-red-300 font-bold mt-1">🔴 Quente</p>
          </div>

          <div className="bg-[#050816] border border-white/10 rounded-xl p-3">
            <p className="text-[10px] text-zinc-400">Não lidas</p>
            <p className="text-xs text-purple-300 font-bold mt-1">
              {conversation.unread_count || 0}
            </p>
          </div>
        </div>

        <select
          className="w-full bg-[#050816] border border-white/10 rounded-xl p-3 mb-3 text-xs"
          value={conversation.status || "Novo Lead"}
          onChange={(e) => updateStatus(conversation.phone, e.target.value)}
        >
          {STATUS_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        {conversation.summary && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-3 mb-3">
            <p className="text-[10px] text-purple-300 mb-1">Resumo IA</p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {conversation.summary}
            </p>
          </div>
        )}

        {conversation.ai_suggestion && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3 mb-3">
            <p className="text-[10px] text-blue-300 mb-1">Sugestão IA</p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {conversation.ai_suggestion}
            </p>

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
              updateDetails(
                conversation.phone,
                e.target.value,
                conversation.notes || ""
              )
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
          <p className="text-[10px] text-zinc-400 mb-2">
            Atendente responsável
          </p>

          <select className="w-full bg-[#0b1023] border border-white/10 rounded-xl p-2 text-xs">
            {agents.map((agent) => (
              <option key={agent}>{agent}</option>
            ))}
          </select>
        </div>

        <div className="bg-[#050816] border border-white/10 rounded-2xl p-3 mb-3">
          <p className="text-[10px] text-zinc-400 mb-2">Timeline</p>

          <div className="space-y-1">
            <p className="text-[10px] text-zinc-300">✅ Lead criado</p>
            <p className="text-[10px] text-zinc-300">💬 Cliente respondeu</p>
            <p className="text-[10px] text-zinc-300">🤖 IA respondeu</p>

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
              <p className="text-[10px] text-green-400 italic animate-pulse">
                digitando...
              </p>
            )}
          </div>

          <div className="h-[320px] overflow-y-auto space-y-2 pr-1">
            {conversation.history?.length ? (
              conversation.history.map((msg, index) => (
                <MessageBubble key={index} msg={msg} />
              ))
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

function MessageBubble({ msg }) {
  const isClient = msg.role === "user";

  return (
    <div
      className={`rounded-xl p-2 text-xs border ${
        isClient
          ? "bg-zinc-800 border-zinc-700"
          : "bg-green-500/10 border-green-500/20"
      }`}
    >
      <div className="flex justify-between mb-1">
        <span className="text-[9px] text-zinc-400">
          {isClient ? "Cliente" : "Luna"}
        </span>

        <span className="text-[9px] text-zinc-500">
          {formatTime(msg.created_at)}
        </span>
      </div>

      <p>{msg.content}</p>

      {msg.type === "image" &&
        msg.media_url && (
          <img
            src={`${API_URL}/api/media/${msg.media_url}`}
            className="mt-2 rounded-xl"
          />
        )}

      {msg.type === "audio" &&
        msg.media_url && (
          <audio
            controls
            className="mt-2 w-full"
          >
            <source
              src={`${API_URL}/api/media/${msg.media_url}`}
            />
          </audio>
        )}

      {msg.type === "document" &&
        msg.media_url && (
          <a
            href={`${API_URL}/api/media/${msg.media_url}`}
            target="_blank"
            className="text-blue-400 underline mt-2 block"
          >
            Abrir documento
          </a>
        )}
    </div>
  );
}

function FinanceCard({
  title,
  value
}) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
      <p className="text-xs text-zinc-400">
        {title}
      </p>

      <p className="text-2xl font-black mt-2">
        {value}
      </p>
    </div>
  );
}

function ChartBox({
  title,
  children
}) {
  return (
    <div className="bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
      <h2 className="font-bold mb-4">
        {title}
      </h2>

      {children}
    </div>
  );
}

function Appointments({
  appointments
}) {
  return (
    <div className="mt-5 bg-[#0b1023] border border-zinc-800 rounded-2xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold">
          Agendamentos
        </h2>

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
              {item.customer_name}
            </p>

            <p className="text-xs text-zinc-400">
              {item.phone}
            </p>

            <p className="text-xs mt-2">
              {item.service}
            </p>

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

function ToastArea({
  toasts
}) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-[#0b1023] border border-zinc-700 rounded-2xl px-5 py-4 shadow-2xl"
        >
          <p className="font-bold text-sm">
            Luna AI
          </p>

          <p className="text-zinc-300 text-sm">
            {toast.message}
          </p>
        </div>
      ))}
    </div>
  );
}

export default App;