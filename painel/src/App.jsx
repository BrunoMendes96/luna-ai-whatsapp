import { useEffect, useMemo, useState } from "react";

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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
      setSession(adminSession);
      return;
    }

    alert("Email ou senha incorretos");
  }

  function logout() {
    localStorage.removeItem("luna_admin");
    setSession(null);
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl w-full max-w-md shadow-2xl"
        >
          <h1 className="text-4xl font-bold mb-2">Luna AI</h1>
          <p className="text-zinc-400 mb-8">Painel administrativo</p>

          <input
            className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-2xl mb-4 outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-2xl mb-6 outline-none"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="w-full bg-white text-black p-4 rounded-2xl font-bold">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return <Dashboard session={session} logout={logout} />;
}

function Dashboard({ session, logout }) {
  const [conversations, setConversations] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [search, setSearch] = useState("");

  async function loadConversations() {
    try {
      const response = await fetch(`${API_URL}/api/conversations`);
      const data = await response.json();
      setConversations(data);

      if (!selectedPhone && data.length > 0) {
        setSelectedPhone(data[data.length - 1].phone);
      }
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
    try {
      const service =
        prompt("Serviço:", "Piercing") || "Serviço não informado";

      const appointmentDate =
        prompt("Data e hora:", "25/05 15:00") || "";

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
        alert(data.error || "Erro ao confirmar agendamento");
        return;
      }

      alert("Agendamento confirmado.");
      await loadConversations();
      await loadAppointments();
    } catch (error) {
      alert(error.message);
    }
  }

  async function cancelAppointment(conversation) {
    await updateStatus(conversation.phone, "Perdido");
    alert("Agendamento cancelado.");
  }

  useEffect(() => {
    loadConversations();
    loadAppointments();

    const interval = setInterval(() => {
      loadConversations();
      loadAppointments();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return conversations;

    return conversations.filter((conversation) => {
      return (
        conversation.phone?.toLowerCase().includes(term) ||
        conversation.customer_name?.toLowerCase().includes(term)
      );
    });
  }, [conversations, search]);

  const selectedConversation =
    conversations.find((item) => item.phone === selectedPhone) ||
    conversations[conversations.length - 1];

  const totals = {
    all: conversations.length,
    novo: conversations.filter(
      (item) => (item.status || "Novo Lead") === "Novo Lead"
    ).length,
    atendimento: conversations.filter(
      (item) => item.status === "Em Atendimento"
    ).length,
    confirmacao: conversations.filter(
      (item) => item.status === "Aguardando Confirmação"
    ).length,
    fechado: conversations.filter((item) => item.status === "Fechado").length
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1900px] mx-auto p-6">
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
          <div>
            <h1 className="text-4xl lg:text-5xl font-bold">Luna AI CRM</h1>
            <p className="text-zinc-400 mt-2">
              Logado como {session.user.email}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                loadConversations();
                loadAppointments();
              }}
              className="bg-zinc-800 hover:bg-zinc-700 px-5 py-3 rounded-2xl"
            >
              Atualizar
            </button>

            <button
              onClick={logout}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-5 py-3 rounded-2xl"
            >
              Sair
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Metric title="Conversas" value={totals.all} />
          <Metric title="Novos" value={totals.novo} />
          <Metric title="Atendimento" value={totals.atendimento} />
          <Metric title="Confirmação" value={totals.confirmacao} />
          <Metric title="Fechados" value={totals.fechado} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(760px,1fr)_360px] gap-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
            <div className="flex items-center justify-between gap-4 mb-5">
              <h2 className="text-2xl font-bold">Funil</h2>

              <input
                className="bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 outline-none w-full max-w-sm"
                placeholder="Buscar cliente ou telefone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-4">
              {STATUS_OPTIONS.filter((status) => status !== "Fechado").map(
                (status) => (
                  <KanbanColumn
                    key={status}
                    status={status}
                    conversations={filteredConversations}
                    selectedPhone={selectedPhone}
                    setSelectedPhone={setSelectedPhone}
                  />
                )
              )}
            </div>

            <div className="mt-6 bg-zinc-950 border border-zinc-800 rounded-3xl p-4">
              <h3 className="text-xl font-bold mb-4">Fechados</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {filteredConversations
                  .filter((item) => item.status === "Fechado")
                  .reverse()
                  .map((conversation) => (
                    <button
                      key={conversation.phone}
                      onClick={() => setSelectedPhone(conversation.phone)}
                      className="text-left bg-zinc-800 hover:bg-zinc-700 rounded-2xl p-4"
                    >
                      <p className="font-bold">
                        {conversation.customer_name || "Cliente"}
                      </p>
                      <p className="text-sm text-zinc-400">
                        {conversation.phone}
                      </p>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 h-[calc(100vh-180px)] flex flex-col">
            {selectedConversation ? (
              <>
                <div className="mb-5">
                  <p className="text-zinc-400 text-sm">Cliente selecionado</p>
                  <h2 className="text-2xl font-bold">
                    {selectedConversation.customer_name || "Cliente"}
                  </h2>
                  <p className="text-zinc-400">{selectedConversation.phone}</p>
                </div>

                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl p-3 mb-3 outline-none"
                  placeholder="Nome do cliente"
                  defaultValue={selectedConversation.customer_name || ""}
                  onBlur={(e) =>
                    updateDetails(
                      selectedConversation.phone,
                      e.target.value,
                      selectedConversation.notes || ""
                    )
                  }
                />

                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl p-3 mb-3 outline-none h-24"
                  placeholder="Observações internas"
                  defaultValue={selectedConversation.notes || ""}
                  onBlur={(e) =>
                    updateDetails(
                      selectedConversation.phone,
                      selectedConversation.customer_name || "",
                      e.target.value
                    )
                  }
                />

                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl p-3 mb-4 outline-none"
                  value={selectedConversation.status || "Novo Lead"}
                  onChange={(e) =>
                    updateStatus(selectedConversation.phone, e.target.value)
                  }
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                {(selectedConversation.status || "").includes("Aguardando") && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={() => confirmAppointment(selectedConversation)}
                      className="bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-2xl p-3 font-bold"
                    >
                      Confirmar
                    </button>

                    <button
                      onClick={() => cancelAppointment(selectedConversation)}
                      className="bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-2xl p-3 font-bold"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto pr-2 space-y-3 border-t border-zinc-800 pt-4">
                  {[...(selectedConversation.history || [])]
                    .reverse()
                    .map((msg, index) => (
                      <div
                        key={index}
                        className={`p-4 rounded-2xl ${
                          msg.role === "user"
                            ? "bg-zinc-800"
                            : "bg-green-500/20"
                        }`}
                      >
                        <p className="text-xs text-zinc-400 mb-1">
                          {msg.role === "user" ? "Cliente" : "IA"}
                        </p>
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500">
                Nenhuma conversa selecionada.
              </div>
            )}
          </div>

          <aside className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 h-[calc(100vh-180px)] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-5">
              Agendamentos Confirmados
            </h2>

            <div className="space-y-4">
              {appointments.length === 0 && (
                <p className="text-zinc-500">Nenhum agendamento confirmado.</p>
              )}

              {appointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="bg-zinc-800 rounded-2xl p-4"
                >
                  <p className="font-bold text-lg">
                    {appointment.customer_name || "Cliente"}
                  </p>

                  <p className="text-zinc-400 text-sm mt-1">
                    {appointment.phone}
                  </p>

                  <div className="mt-4 space-y-2 text-sm">
                    <p>
                      <span className="text-zinc-400">Serviço:</span>{" "}
                      {appointment.service}
                    </p>

                    <p>
                      <span className="text-zinc-400">Data/Hora:</span>{" "}
                      {appointment.appointment_date}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  conversations,
  selectedPhone,
  setSelectedPhone
}) {
  const filtered = conversations
    .filter((item) => (item.status || "Novo Lead") === status)
    .reverse();

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-4 min-h-[520px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">{status}</h3>
        <span className="bg-zinc-800 text-zinc-300 rounded-full px-3 py-1 text-sm">
          {filtered.length}
        </span>
      </div>

      <div className="space-y-3">
        {filtered.map((conversation) => (
          <button
            key={conversation.phone}
            onClick={() => setSelectedPhone(conversation.phone)}
            className={`w-full text-left rounded-2xl p-4 transition ${
              selectedPhone === conversation.phone
                ? "bg-blue-500/20 border border-blue-500/40"
                : "bg-zinc-800 hover:bg-zinc-700 border border-transparent"
            }`}
          >
            <p className="font-bold">
              {conversation.customer_name || "Cliente"}
            </p>

            <p className="text-sm text-zinc-400 mt-1">{conversation.phone}</p>

            <p className="text-xs text-zinc-500 mt-3 line-clamp-2">
              {conversation.history?.[conversation.history.length - 1]
                ?.content || "Sem mensagens"}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ title, value }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
      <p className="text-zinc-400 text-sm">{title}</p>
      <p className="text-4xl font-bold mt-3">{value}</p>
    </div>
  );
}

export default App;