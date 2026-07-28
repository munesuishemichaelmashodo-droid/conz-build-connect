import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { C as Send, Tt as ArrowLeft } from "../_libs/lucide-react.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-n1riXnH5.mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Route } from "./chat._jobId-DEHT_RAF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/chat._jobId-CJqOzkax.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function ChatPage() {
	const { jobId } = Route.useParams();
	const { userId } = useAuth();
	const [messages, setMessages] = (0, import_react.useState)([]);
	const [body, setBody] = (0, import_react.useState)("");
	const [sending, setSending] = (0, import_react.useState)(false);
	const scrollerRef = (0, import_react.useRef)(null);
	const { data: job } = useQuery({
		queryKey: ["job-chat-meta", jobId],
		queryFn: async () => {
			const { data } = await supabase.from("jobs").select("id,customer_id,driver_id,material,custom_material").eq("id", jobId).maybeSingle();
			return data;
		}
	});
	const otherId = job ? job.customer_id === userId ? job.driver_id : job.customer_id : null;
	const { data: otherProfile } = useQuery({
		queryKey: ["chat-peer", otherId],
		enabled: !!otherId,
		queryFn: async () => {
			const { data } = await supabase.from("profiles").select("full_name,avatar_url").eq("id", otherId).maybeSingle();
			return data;
		}
	});
	(0, import_react.useEffect)(() => {
		let mounted = true;
		(async () => {
			const { data } = await supabase.from("messages").select("*").eq("job_id", jobId).order("created_at");
			if (mounted && data) setMessages(data);
		})();
		const channel = supabase.channel(`chat:${jobId}`).on("postgres_changes", {
			event: "INSERT",
			schema: "public",
			table: "messages",
			filter: `job_id=eq.${jobId}`
		}, (payload) => setMessages((prev) => [...prev, payload.new])).subscribe();
		return () => {
			mounted = false;
			supabase.removeChannel(channel);
		};
	}, [jobId]);
	(0, import_react.useEffect)(() => {
		scrollerRef.current?.scrollTo({
			top: scrollerRef.current.scrollHeight,
			behavior: "smooth"
		});
	}, [messages]);
	const send = async (e) => {
		e.preventDefault();
		const text = body.trim();
		if (!text) return;
		setSending(true);
		const { error } = await supabase.from("messages").insert({
			job_id: jobId,
			sender_id: userId,
			body: text
		});
		setSending(false);
		if (error) return toast.error(error.message);
		setBody("");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AppShell, {
		title: otherProfile?.full_name ? `Chat · ${otherProfile.full_name}` : "Chat",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
			to: "/jobs/$id",
			params: { id: jobId },
			className: "inline-flex items-center gap-1 text-sm text-muted-foreground mb-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "w-4 h-4" }), " Back to job"]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex flex-col h-[calc(100vh-220px)] rounded-2xl bg-card border overflow-hidden",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				ref: scrollerRef,
				className: "flex-1 overflow-y-auto p-4 space-y-2",
				children: [messages.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-center text-xs text-muted-foreground py-8",
					children: "No messages yet. Say hi 👋"
				}), messages.map((m) => {
					const mine = m.sender_id === userId;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: `flex ${mine ? "justify-end" : "justify-start"}`,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: `max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "whitespace-pre-wrap break-words",
								children: m.body
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: `text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`,
								children: new Date(m.created_at).toLocaleTimeString([], {
									hour: "2-digit",
									minute: "2-digit"
								})
							})]
						})
					}, m.id);
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: send,
				className: "border-t p-2 flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					value: body,
					onChange: (e) => setBody(e.target.value),
					placeholder: "Type a message…",
					maxLength: 1e3
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					disabled: sending || !body.trim(),
					size: "icon",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Send, { className: "w-4 h-4" })
				})]
			})]
		})]
	});
}
//#endregion
export { ChatPage as component };
