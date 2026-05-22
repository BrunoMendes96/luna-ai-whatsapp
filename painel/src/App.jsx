import { useEffect, useState } from "react";

const API_URL = "https://luna-ai-whatsapp-production.up.railway.app";

const STATUS_OPTIONS = [
  "Novo Lead",
  "Em Atendimento",
  "Aguardando Confirmação",
  "Fechado",
  "Perdido"
];

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
    const response = await fetch(`${API_URL}/api/conversations`);
    const data = await response.json();
    setConversations(data);
  }

  async function loadAppointments() {
    const response = await fetch(`${API_URL}/api/appointments`);
    const data = await response.json();
    setAppointments(data);
  }

  async function updateStatus(phone, status) {
    await fetch(`${API_URL}/api/conversations/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, status })
    });

    loadConversations();
  }

  async function updateDetails(phone, customer_name, notes) {
    await fetch(`${API_URL}/api/conversations/details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, customer_name, notes })
    });

    loadConversations();
  }

  async function confirmAppointment(conversation) {
    const service = prompt("Serviço:", "Piercing") || "Serviço não informado";
    const appointmentDate = prompt("Data e hora:", "25/05 15:00") || "";

    if (!appointmentDate) return;

    const response = await fetch(`${API_URL}/api/confirm-appointment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    alert("Agendamento confirmado!");
    loadConversations();
    loadAppointments();
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
        <form onSubmit={login} className="bg-zinc-900 p-8 rounded-2xl w-full max-w-sm">
          <h1 className="text-3xl font-bold mb-6">Luna AI</h1>

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-3"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 p-3 rounded-xl mb-5"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

<div className="flex items-center gap-2 mb-5">
  <input
    type="checkbox"
    checked={remember}
    onChange={(e) => setRemember(e.target.checked)}
  />

  <p className="text-sm text-zinc-400">
    Lembrar acesso
  </p>
</div>

          <button className="w-full bg-white text-black p-3 rounded-xl font-bold">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4">
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

        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {STATUS_OPTIONS.map((status) => (
            <Column
              key={status}
              status={status}
              conversations={conversations}
              updateStatus={updateStatus}
              updateDetails={updateDetails}
              confirmAppointment={confirmAppointment}
            />
          ))}

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
                  <p className="text-xs text-green-400">{item.appointment_date}</p>
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
  status,
  conversations,
  updateStatus,
  updateDetails,
  confirmAppointment
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
          <div key={conversation.phone} className="bg-zinc-800 rounded-2xl p-3">
            <p className="font-bold text-sm mb-3">{conversation.phone}</p>

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
                  <div
                    key={index}
                    className={`rounded-xl p-2 text-sm ${
                      msg.role === "user"
                        ? "bg-zinc-700"
                        : "bg-green-500/20"
                    }`}
                  >
                    <p className="text-[10px] text-zinc-400 mb-1">
                      {msg.role === "user" ? "Cliente" : "IA"}
                    </p>
                    <p>{msg.content}</p>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;