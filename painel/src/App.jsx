import { useEffect, useRef, useState } from "react";

const API_URL = "https://luna-ai-whatsapp-production.up.railway.app";

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

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

  return new Date(date).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
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
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [toasts, setToasts] = useState([]);

  const lastMessageCountRef = useRef(0);
  const hasInteractedRef = useRef(false);

  function addToast(message) {
    const id = Date.now();

    setToasts((prev) => [...prev, { id, message }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
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

        addToast("Nova mensagem recebida no CRM");
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
        appointment_date: appointmentDate
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Erro ao confirmar");
      return;
    }

    addToast("Agendamento confirmado com sucesso");
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
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-zinc-900 p-8 rounded-2xl w-full max-w-sm border border-zinc-800"
        >
          <h1 className="text-3xl font-bold mb-2">Luna AI</h1>
          <p className="text-zinc-400 text-sm mb-6">Painel administrativo</p>

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-3"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-4"
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
      className="min-h-screen bg-zinc-950 text-white p-4"
      onClick={() => {
        hasInteractedRef.current = true;
      }}
    >
      <ToastArea toasts={toasts} />

      <div className="max-w-[1800px] mx-auto">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-3xl font-bold">Luna AI CRM</h1>
            <p className="text-zinc-400 text-sm">{session.user.email}</p>
          </div>

          <button
            onClick={logout}
            className="bg-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm"
          >
            Sair
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
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
              selectedConversation={selectedConversation}
              setSelectedConversation={setSelectedConversation}
            />
          ))}

<div className="bg-zinc-900 border border-zinc-800 rounded-2xl h-[680px] flex flex-col overflow-hidden">
  {selectedConversation ? (
    <>
      <div className="border-b border-zinc-800 p-4">
        <h2 className="text-xl font-bold">
          {selectedConversation.customer_name || "Cliente"}
        </h2>

        <p className="text-zinc-400 text-sm">
          {selectedConversation.phone}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {[...(selectedConversation.history || [])]
          .reverse()
          .map((msg, index) => (
            <MessageBubble key={index} msg={msg} />
          ))}
      </div>

      <div className="border-t border-zinc-800 p-4 flex gap-2">
        <input
          className="flex-1 bg-zinc-800 rounded-xl p-3 text-sm"
          placeholder="Responder cliente..."
          value={replyMessage[selectedConversation.phone] || ""}
          onChange={(e) =>
            setReplyMessage((prev) => ({
              ...prev,
              [selectedConversation.phone]: e.target.value
            }))
          }
        />

        <button
          onClick={() =>
            sendManualMessage(selectedConversation.phone)
          }
          className="bg-blue-500/20 text-blue-400 px-5 rounded-xl"
        >
          Enviar
        </button>
      </div>
    </>
  ) : (
    <div className="flex items-center justify-center h-full text-zinc-500">
      Selecione uma conversa
    </div>
  )}
</div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 h-[680px] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Agendamentos</h2>

            <div className="space-y-3">
              {appointments.map((item) => (
                <div key={item.id} className="bg-zinc-800 rounded-xl p-3">
                  <p className="font-bold text-sm">
                    {item.customer_name || "Cliente"}
                  </p>
                  <p className="text-xs text-zinc-400">{item.phone}</p>
                  <p className="text-xs mt-2">{item.service}</p>
                  <p className="text-xs text-green-400">
                    {item.appointment_date}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({
  selectedConversation,
setSelectedConversation,
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 h-[680px] overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{status}</h2>
        <span className="bg-zinc-800 px-2 py-1 rounded-lg text-xs">
          {filtered.length}
        </span>
      </div>

      <div className="space-y-4">
        {filtered.map((conversation) => (
          <div
  key={conversation.phone}
  onClick={() => setSelectedConversation(conversation)}
  className="bg-zinc-800 rounded-2xl p-3 cursor-pointer hover:bg-zinc-700 transition"
>
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-sm">{conversation.phone}</p>

              {(conversation.status || "Novo Lead") === "Novo Lead" && (
                <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-1 rounded-full">
                  NOVO
                </span>
              )}
            </div>

            <input
              className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-sm"
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
              className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-sm h-14"
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
              className="w-full bg-zinc-900 rounded-lg p-2 mb-2 text-sm"
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
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  onClick={() => confirmAppointment(conversation)}
                  className="bg-green-500/20 text-green-400 rounded-lg p-2 text-sm"
                >
                  Confirmar
                </button>

                <button
                  onClick={() => updateStatus(conversation.phone, "Perdido")}
                  className="bg-red-500/20 text-red-400 rounded-lg p-2 text-sm"
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="h-64 overflow-y-auto space-y-2 pr-1 border-t border-zinc-700 pt-3">
              {[...(conversation.history || [])]
                .reverse()
                .map((msg, index) => (
                  <MessageBubble key={index} msg={msg} />
                ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                className="flex-1 bg-zinc-900 rounded-lg p-2 text-sm"
                placeholder="Responder..."
                value={replyMessage[conversation.phone] || ""}
                onChange={(e) =>
                  setReplyMessage((prev) => ({
                    ...prev,
                    [conversation.phone]: e.target.value
                  }))
                }
              />

              <button
                onClick={() => sendManualMessage(conversation.phone)}
                className="bg-blue-500/20 text-blue-400 px-3 rounded-lg text-sm"
              >
                Enviar
              </button>
            </div>
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
      className={`rounded-xl p-2 text-sm border ${
        isClient
          ? "bg-zinc-700 border-zinc-600"
          : "bg-green-500/20 border-green-500/20"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              isClient
                ? "bg-blue-500/30 text-blue-300"
                : "bg-green-500/30 text-green-300"
            }`}
          >
            {isClient ? "C" : "IA"}
          </div>

          <p className="text-[10px] text-zinc-400">
            {isClient ? "Cliente" : "Luna IA"}
          </p>
        </div>

        <p className="text-[10px] text-zinc-500">
          {formatTime(msg.created_at)}
        </p>
      </div>

      <p>{msg.content}</p>
    </div>
  );
}

function ToastArea({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-zinc-900 border border-zinc-700 text-white rounded-2xl px-5 py-4 shadow-2xl animate-pulse"
        >
          <p className="font-bold text-sm">Luna AI CRM</p>
          <p className="text-zinc-300 text-sm">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}

export default App;