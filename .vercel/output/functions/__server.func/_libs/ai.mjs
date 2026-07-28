import { r as __exportAll } from "../_runtime.mjs";
import { B as resolve, Bt as AISDKError, C as executeTool, Ct as strictObject, D as getRuntimeEnvironmentUserAgent, Et as unknown, F as lazySchema, H as retryWithExponentialBackoff, Ht as InvalidPromptError, K as validateTypes, Kt as getErrorMessage, M as isFullMediaType, N as isProviderReference, P as isUrlSupported, St as record, T as filterNullable, Tt as union, U as safeParseJSON, Vt as APICallError, W as safeValidateTypes, Wt as TypeValidationError, Y as zodSchema, _t as never, at as _enum, d as cancelResponseBody, dt as custom, ft as discriminatedUnion, g as convertUint8ArrayToBase64, ht as literal, j as isExecutableTool, k as isBuffer, l as asArray, lt as array$1, mt as lazy, n as GatewayError, o as DEFAULT_MAX_DOWNLOAD_SIZE, ot as _instanceof, p as convertBase64ToUint8Array, q as withUserAgentSuffix, r as gateway, s as DownloadError, st as _null, t as GatewayAuthenticationError, u as asSchema, ut as boolean, v as createIdGenerator, vt as number, w as fetchWithValidatedRedirects, wt as string, x as detectMediaType, yt as object$1, z as readResponseWithSizeLimit } from "./@ai-sdk/gateway+[...].mjs";
//#region node_modules/ai/dist/index.js
var dist_exports = /* @__PURE__ */ __exportAll({
	AI_SDK_TELEMETRY_TRACING_CHANNEL: () => AI_SDK_TELEMETRY_TRACING_CHANNEL,
	DefaultGeneratedFile: () => DefaultGeneratedFile,
	InvalidArgumentError: () => InvalidArgumentError,
	InvalidDataContentError: () => InvalidDataContentError,
	InvalidMessageRoleError: () => InvalidMessageRoleError,
	InvalidToolApprovalError: () => InvalidToolApprovalError,
	InvalidToolApprovalSignatureError: () => InvalidToolApprovalSignatureError,
	InvalidToolInputError: () => InvalidToolInputError,
	MissingToolResultsError: () => MissingToolResultsError,
	NoObjectGeneratedError: () => NoObjectGeneratedError,
	NoOutputGeneratedError: () => NoOutputGeneratedError,
	NoSuchToolError: () => NoSuchToolError,
	Output: () => output_exports,
	RetryError: () => RetryError,
	ToolCallNotFoundForApprovalError: () => ToolCallNotFoundForApprovalError,
	ToolCallRepairError: () => ToolCallRepairError,
	UnsupportedModelVersionError: () => UnsupportedModelVersionError,
	assistantModelMessageSchema: () => assistantModelMessageSchema,
	createDownload: () => createDownload,
	experimental_filterActiveTools: () => filterActiveTools,
	generateText: () => generateText,
	getStepTimeoutMs: () => getStepTimeoutMs,
	getToolTimeoutMs: () => getToolTimeoutMs,
	getTotalTimeoutMs: () => getTotalTimeoutMs,
	isStepCount: () => isStepCount,
	modelMessageSchema: () => modelMessageSchema,
	parsePartialJson: () => parsePartialJson,
	stepCountIs: () => isStepCount,
	systemModelMessageSchema: () => systemModelMessageSchema,
	toolModelMessageSchema: () => toolModelMessageSchema,
	userModelMessageSchema: () => userModelMessageSchema
});
var __defProp = Object.defineProperty;
var __export = (target, all) => {
	for (var name22 in all) __defProp(target, name22, {
		get: all[name22],
		enumerable: true
	});
};
var name = "AI_InvalidArgumentError";
var marker = `vercel.ai.error.${name}`;
var symbol = Symbol.for(marker);
var _a;
var InvalidArgumentError = class extends AISDKError {
	constructor({ parameter, value, message }) {
		super({
			name,
			message: `Invalid argument for parameter ${parameter}: ${message}`
		});
		this[_a] = true;
		this.parameter = parameter;
		this.value = value;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker);
	}
};
_a = symbol;
var name3 = "AI_InvalidToolApprovalError";
var marker3 = `vercel.ai.error.${name3}`;
var symbol3 = Symbol.for(marker3);
var _a3;
var InvalidToolApprovalError = class extends AISDKError {
	constructor({ approvalId }) {
		super({
			name: name3,
			message: `Tool approval response references unknown approvalId: "${approvalId}". No matching tool-approval-request found in message history.`
		});
		this[_a3] = true;
		this.approvalId = approvalId;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker3);
	}
};
_a3 = symbol3;
var name4 = "AI_InvalidToolApprovalSignatureError";
var marker4 = `vercel.ai.error.${name4}`;
var symbol4 = Symbol.for(marker4);
var _a4;
var InvalidToolApprovalSignatureError = class extends AISDKError {
	constructor({ approvalId, toolCallId, reason }) {
		super({
			name: name4,
			message: `Tool approval signature verification failed for approval "${approvalId}" (tool call "${toolCallId}"): ${reason}`
		});
		this[_a4] = true;
		this.approvalId = approvalId;
		this.toolCallId = toolCallId;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker4);
	}
};
_a4 = symbol4;
var name5 = "AI_InvalidToolInputError";
var marker5 = `vercel.ai.error.${name5}`;
var symbol5 = Symbol.for(marker5);
var _a5;
var InvalidToolInputError = class extends AISDKError {
	constructor({ toolInput, toolName, cause, message = `Invalid input for tool ${toolName}: ${getErrorMessage(cause)}` }) {
		super({
			name: name5,
			message,
			cause
		});
		this[_a5] = true;
		this.toolInput = toolInput;
		this.toolName = toolName;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker5);
	}
};
_a5 = symbol5;
var name6 = "AI_ToolCallNotFoundForApprovalError";
var marker6 = `vercel.ai.error.${name6}`;
var symbol6 = Symbol.for(marker6);
var _a6;
var ToolCallNotFoundForApprovalError = class extends AISDKError {
	constructor({ toolCallId, approvalId }) {
		super({
			name: name6,
			message: `Tool call "${toolCallId}" not found for approval request "${approvalId}".`
		});
		this[_a6] = true;
		this.toolCallId = toolCallId;
		this.approvalId = approvalId;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker6);
	}
};
_a6 = symbol6;
var name7 = "AI_MissingToolResultsError";
var marker7 = `vercel.ai.error.${name7}`;
var symbol7 = Symbol.for(marker7);
var _a7;
var MissingToolResultsError = class extends AISDKError {
	constructor({ toolCallIds }) {
		super({
			name: name7,
			message: `Tool result${toolCallIds.length > 1 ? "s are" : " is"} missing for tool call${toolCallIds.length > 1 ? "s" : ""} ${toolCallIds.join(", ")}.`
		});
		this[_a7] = true;
		this.toolCallIds = toolCallIds;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker7);
	}
};
_a7 = symbol7;
var name9 = "AI_NoObjectGeneratedError";
var marker9 = `vercel.ai.error.${name9}`;
var symbol9 = Symbol.for(marker9);
var _a9;
var NoObjectGeneratedError = class extends AISDKError {
	constructor({ message = "No object generated.", cause, text: text2, response, usage, finishReason }) {
		super({
			name: name9,
			message,
			cause
		});
		this[_a9] = true;
		this.text = text2;
		this.response = response;
		this.usage = usage;
		this.finishReason = finishReason;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker9);
	}
};
_a9 = symbol9;
var name10 = "AI_NoOutputGeneratedError";
var marker10 = `vercel.ai.error.${name10}`;
var symbol10 = Symbol.for(marker10);
var _a10;
var NoOutputGeneratedError = class extends AISDKError {
	constructor({ message = "No output generated.", cause } = {}) {
		super({
			name: name10,
			message,
			cause
		});
		this[_a10] = true;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker10);
	}
};
_a10 = symbol10;
var name14 = "AI_NoSuchToolError";
var marker14 = `vercel.ai.error.${name14}`;
var symbol14 = Symbol.for(marker14);
var _a14;
var NoSuchToolError = class extends AISDKError {
	constructor({ toolName, availableTools = void 0, message = `Model tried to call unavailable tool '${toolName}'. ${availableTools === void 0 ? "No tools are available." : `Available tools: ${availableTools.join(", ")}.`}` }) {
		super({
			name: name14,
			message
		});
		this[_a14] = true;
		this.toolName = toolName;
		this.availableTools = availableTools;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker14);
	}
};
_a14 = symbol14;
var name15 = "AI_ToolCallRepairError";
var marker15 = `vercel.ai.error.${name15}`;
var symbol15 = Symbol.for(marker15);
var _a15;
var ToolCallRepairError = class extends AISDKError {
	constructor({ cause, originalError, message = `Error repairing tool call: ${getErrorMessage(cause)}` }) {
		super({
			name: name15,
			message,
			cause
		});
		this[_a15] = true;
		this.originalError = originalError;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker15);
	}
};
_a15 = symbol15;
var UnsupportedModelVersionError = class extends AISDKError {
	constructor(options) {
		super({
			name: "AI_UnsupportedModelVersionError",
			message: `Unsupported model version ${options.version} for provider "${options.provider}" and model "${options.modelId}". AI SDK 5 only supports models that implement specification version "v2".`
		});
		this.version = options.version;
		this.provider = options.provider;
		this.modelId = options.modelId;
	}
};
var name17 = "AI_InvalidDataContentError";
var marker17 = `vercel.ai.error.${name17}`;
var symbol17 = Symbol.for(marker17);
var _a17;
var InvalidDataContentError = class extends AISDKError {
	constructor({ content, cause, message = `Invalid data content. Expected a base64 string, Uint8Array, ArrayBuffer, or Buffer, but got ${typeof content}.` }) {
		super({
			name: name17,
			message,
			cause
		});
		this[_a17] = true;
		this.content = content;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker17);
	}
};
_a17 = symbol17;
var name18 = "AI_InvalidMessageRoleError";
var marker18 = `vercel.ai.error.${name18}`;
var symbol18 = Symbol.for(marker18);
var _a18;
var InvalidMessageRoleError = class extends AISDKError {
	constructor({ role, message = `Invalid message role: '${role}'. Must be one of: "system", "user", "assistant", "tool".` }) {
		super({
			name: name18,
			message
		});
		this[_a18] = true;
		this.role = role;
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker18);
	}
};
_a18 = symbol18;
var name20 = "AI_RetryError";
var marker20 = `vercel.ai.error.${name20}`;
var symbol20 = Symbol.for(marker20);
var _a20;
var RetryError = class extends AISDKError {
	constructor({ message, reason, errors }) {
		super({
			name: name20,
			message
		});
		this[_a20] = true;
		this.reason = reason;
		this.errors = errors;
		this.lastError = errors[errors.length - 1];
	}
	static isInstance(error) {
		return AISDKError.hasMarker(error, marker20);
	}
};
_a20 = symbol20;
function formatWarning({ warning, provider, model }) {
	const prefix = `AI SDK Warning${provider != null && model != null ? ` (${provider} / ${model})` : ""}:`;
	switch (warning.type) {
		case "unsupported": {
			let message = `${prefix} The feature "${warning.feature}" is not supported.`;
			if (warning.details) message += ` ${warning.details}`;
			return message;
		}
		case "compatibility": {
			let message = `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`;
			if (warning.details) message += ` ${warning.details}`;
			return message;
		}
		case "deprecated": return `${prefix} Deprecated: "${warning.setting}". ${warning.message}`;
		case "other": return `${prefix} ${warning.message}`;
		default: return `${prefix} ${JSON.stringify(warning, null, 2)}`;
	}
}
var FIRST_WARNING_INFO_MESSAGE = "AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.";
var hasLoggedBefore = false;
var logWarnings = (options) => {
	if (options.warnings.length === 0) return;
	const logger = globalThis.AI_SDK_LOG_WARNINGS;
	if (logger === false) return;
	if (typeof logger === "function") {
		logger(options);
		return;
	}
	if (!hasLoggedBefore) {
		hasLoggedBefore = true;
		console.info(FIRST_WARNING_INFO_MESSAGE);
	}
	for (const warning of options.warnings) {
		const message = formatWarning({
			warning,
			provider: options.provider,
			model: options.model
		});
		if (typeof process !== "undefined" && typeof process.emitWarning === "function") process.emitWarning(message, { type: warning.type === "deprecated" ? "DeprecationWarning" : "Warning" });
		else console.warn(message);
	}
};
function logV2CompatibilityWarning({ provider, modelId }) {
	logWarnings({
		warnings: [{
			type: "compatibility",
			feature: "specificationVersion",
			details: `Using v2 specification compatibility mode. Some features may not be available.`
		}],
		provider,
		model: modelId
	});
}
function asEmbeddingModelV3(model) {
	if (model.specificationVersion === "v3") return model;
	logV2CompatibilityWarning({
		provider: model.provider,
		modelId: model.modelId
	});
	return new Proxy(model, { get(target, prop) {
		if (prop === "specificationVersion") return "v3";
		return target[prop];
	} });
}
function asEmbeddingModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	const v3Model = model.specificationVersion === "v2" ? asEmbeddingModelV3(model) : model;
	return new Proxy(v3Model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asImageModelV3(model) {
	if (model.specificationVersion === "v3") return model;
	logV2CompatibilityWarning({
		provider: model.provider,
		modelId: model.modelId
	});
	return new Proxy(model, { get(target, prop) {
		if (prop === "specificationVersion") return "v3";
		return target[prop];
	} });
}
function asImageModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	const v3Model = model.specificationVersion === "v2" ? asImageModelV3(model) : model;
	return new Proxy(v3Model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asLanguageModelV3(model) {
	if (model.specificationVersion === "v3") return model;
	logV2CompatibilityWarning({
		provider: model.provider,
		modelId: model.modelId
	});
	return new Proxy(model, { get(target, prop) {
		switch (prop) {
			case "specificationVersion": return "v3";
			case "doGenerate": return async (...args) => {
				const result = await target.doGenerate(...args);
				return {
					...result,
					finishReason: convertV2FinishReasonToV3(result.finishReason),
					usage: convertV2UsageToV3(result.usage)
				};
			};
			case "doStream": return async (...args) => {
				const result = await target.doStream(...args);
				return {
					...result,
					stream: convertV2StreamToV3(result.stream)
				};
			};
			default: return target[prop];
		}
	} });
}
function convertV2StreamToV3(stream) {
	return stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
		switch (chunk.type) {
			case "finish":
				controller.enqueue({
					...chunk,
					finishReason: convertV2FinishReasonToV3(chunk.finishReason),
					usage: convertV2UsageToV3(chunk.usage)
				});
				break;
			default:
				controller.enqueue(chunk);
				break;
		}
	} }));
}
function convertV2FinishReasonToV3(finishReason) {
	return {
		unified: finishReason === "unknown" ? "other" : finishReason,
		raw: void 0
	};
}
function convertV2UsageToV3(usage) {
	return {
		inputTokens: {
			total: usage.inputTokens,
			noCache: void 0,
			cacheRead: usage.cachedInputTokens,
			cacheWrite: void 0
		},
		outputTokens: {
			total: usage.outputTokens,
			text: void 0,
			reasoning: usage.reasoningTokens
		}
	};
}
function asLanguageModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	const v3Model = model.specificationVersion === "v2" ? asLanguageModelV3(model) : model;
	return new Proxy(v3Model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asRerankingModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	return new Proxy(model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asSpeechModelV3(model) {
	if (model.specificationVersion === "v3") return model;
	logV2CompatibilityWarning({
		provider: model.provider,
		modelId: model.modelId
	});
	return new Proxy(model, { get(target, prop) {
		if (prop === "specificationVersion") return "v3";
		return target[prop];
	} });
}
function asSpeechModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	const v3Model = model.specificationVersion === "v2" ? asSpeechModelV3(model) : model;
	return new Proxy(v3Model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asTranscriptionModelV3(model) {
	if (model.specificationVersion === "v3") return model;
	logV2CompatibilityWarning({
		provider: model.provider,
		modelId: model.modelId
	});
	return new Proxy(model, { get(target, prop) {
		if (prop === "specificationVersion") return "v3";
		return target[prop];
	} });
}
function asTranscriptionModelV4(model) {
	if (model.specificationVersion === "v4") return model;
	const v3Model = model.specificationVersion === "v2" ? asTranscriptionModelV3(model) : model;
	return new Proxy(v3Model, { get(target, prop) {
		if (prop === "specificationVersion") return "v4";
		return target[prop];
	} });
}
function asProviderV3(provider) {
	if ("specificationVersion" in provider && provider.specificationVersion === "v3") return provider;
	const v2Provider = provider;
	return {
		specificationVersion: "v3",
		languageModel: (modelId) => asLanguageModelV3(v2Provider.languageModel(modelId)),
		embeddingModel: (modelId) => asEmbeddingModelV3(v2Provider.textEmbeddingModel(modelId)),
		imageModel: (modelId) => asImageModelV3(v2Provider.imageModel(modelId)),
		transcriptionModel: v2Provider.transcriptionModel ? (modelId) => asTranscriptionModelV3(v2Provider.transcriptionModel(modelId)) : void 0,
		speechModel: v2Provider.speechModel ? (modelId) => asSpeechModelV3(v2Provider.speechModel(modelId)) : void 0,
		rerankingModel: void 0
	};
}
function asProviderV4(provider) {
	if ("specificationVersion" in provider && provider.specificationVersion === "v4") return provider;
	const v3Provider = !("specificationVersion" in provider) || provider.specificationVersion !== "v3" ? asProviderV3(provider) : provider;
	return {
		specificationVersion: "v4",
		languageModel: (modelId) => asLanguageModelV4(v3Provider.languageModel(modelId)),
		embeddingModel: (modelId) => asEmbeddingModelV4(v3Provider.embeddingModel(modelId)),
		imageModel: (modelId) => asImageModelV4(v3Provider.imageModel(modelId)),
		transcriptionModel: v3Provider.transcriptionModel ? (modelId) => asTranscriptionModelV4(v3Provider.transcriptionModel(modelId)) : void 0,
		speechModel: v3Provider.speechModel ? (modelId) => asSpeechModelV4(v3Provider.speechModel(modelId)) : void 0,
		rerankingModel: v3Provider.rerankingModel ? (modelId) => asRerankingModelV4(v3Provider.rerankingModel(modelId)) : void 0
	};
}
function resolveLanguageModel(model) {
	if (typeof model === "string") return getGlobalProvider().languageModel(model);
	if (![
		"v4",
		"v3",
		"v2"
	].includes(model.specificationVersion)) {
		const unsupportedModel = model;
		throw new UnsupportedModelVersionError({
			version: unsupportedModel.specificationVersion,
			provider: unsupportedModel.provider,
			modelId: unsupportedModel.modelId
		});
	}
	return asLanguageModelV4(model);
}
function getGlobalProvider() {
	var _a22;
	return asProviderV4((_a22 = globalThis.AI_SDK_DEFAULT_PROVIDER) != null ? _a22 : gateway);
}
function cloneModelMessages(messages) {
	return messages.map((message) => cloneValue(message));
}
function cloneValue(value) {
	if (value instanceof URL) return new URL(value.href);
	if (Array.isArray(value)) return value.map((item) => cloneValue(item));
	if (value instanceof Uint8Array) return new Uint8Array(value);
	if (value instanceof ArrayBuffer) return value.slice(0);
	if (value instanceof Date) return new Date(value);
	if (value != null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, value2]) => [key, cloneValue(value2)]));
	return value;
}
var VERSION = "7.0.26";
var download = async ({ url, maxBytes, abortSignal }) => {
	var _a22;
	const urlText = url.toString();
	try {
		const response = await fetchWithValidatedRedirects({
			url: urlText,
			headers: withUserAgentSuffix({}, `ai-sdk/${VERSION}`, getRuntimeEnvironmentUserAgent()),
			abortSignal
		});
		if (!response.ok) {
			await cancelResponseBody(response);
			throw new DownloadError({
				url: urlText,
				statusCode: response.status,
				statusText: response.statusText
			});
		}
		return {
			data: await readResponseWithSizeLimit({
				response,
				url: urlText,
				maxBytes: maxBytes != null ? maxBytes : DEFAULT_MAX_DOWNLOAD_SIZE
			}),
			mediaType: (_a22 = response.headers.get("content-type")) != null ? _a22 : void 0
		};
	} catch (error) {
		if (DownloadError.isInstance(error)) throw error;
		throw new DownloadError({
			url: urlText,
			cause: error
		});
	}
};
var createDefaultDownloadFunction = (download2 = download) => (requestedDownloads) => Promise.all(requestedDownloads.map(async (requestedDownload) => requestedDownload.isUrlSupportedByModel ? null : await download2(requestedDownload)));
function splitDataUrl(dataUrl) {
	try {
		const [header, base64Content] = dataUrl.split(",");
		return {
			mediaType: header.split(";")[0].split(":")[1],
			base64Content
		};
	} catch (e) {
		return {
			mediaType: void 0,
			base64Content: void 0
		};
	}
}
function isTaggedFileData(value) {
	if (typeof value !== "object" || value === null) return false;
	const type = value.type;
	return type === "data" || type === "url" || type === "reference" || type === "text";
}
function convertUrlToFilePartData(url) {
	if (url.protocol === "data:") {
		const { mediaType, base64Content } = splitDataUrl(url.toString());
		if (mediaType == null || base64Content == null) throw new InvalidDataContentError({
			content: url,
			message: `Invalid data URL format in content ${url.toString()}`
		});
		return {
			data: {
				type: "data",
				data: base64Content
			},
			mediaType
		};
	}
	return {
		data: {
			type: "url",
			url
		},
		mediaType: void 0
	};
}
function convertInlineDataToFilePartData(content) {
	if (content instanceof Uint8Array) return {
		data: {
			type: "data",
			data: content
		},
		mediaType: void 0
	};
	if (content instanceof ArrayBuffer) return {
		data: {
			type: "data",
			data: new Uint8Array(content)
		},
		mediaType: void 0
	};
	if (isBuffer(content)) return {
		data: {
			type: "data",
			data: new Uint8Array(content)
		},
		mediaType: void 0
	};
	return {
		data: {
			type: "data",
			data: content
		},
		mediaType: void 0
	};
}
function convertToLanguageModelV4FilePart(content) {
	if (isTaggedFileData(content)) switch (content.type) {
		case "data":
			if (typeof content.data === "string" && content.data.startsWith("data:")) throw new InvalidDataContentError({
				content: content.data,
				message: "Data URLs are not valid inline data. Pass them as { type: \"url\", url } instead."
			});
			return convertInlineDataToFilePartData(content.data);
		case "url": return convertUrlToFilePartData(content.url);
		case "reference": return {
			data: {
				type: "reference",
				reference: content.reference
			},
			mediaType: void 0
		};
		case "text": return {
			data: {
				type: "text",
				text: content.text
			},
			mediaType: void 0
		};
	}
	if (content instanceof URL) return convertUrlToFilePartData(content);
	if (typeof content === "string") try {
		return convertUrlToFilePartData(new URL(content));
	} catch (e) {
		return convertInlineDataToFilePartData(content);
	}
	if (isProviderReference(content)) return {
		data: {
			type: "reference",
			reference: content
		},
		mediaType: void 0
	};
	return convertInlineDataToFilePartData(content);
}
async function convertToLanguageModelPrompt({ prompt, supportedUrls, download: download2 = createDefaultDownloadFunction(), provider }) {
	const downloadedAssets = await downloadAssets(prompt.messages, download2, supportedUrls);
	const approvalIdToToolCallId = /* @__PURE__ */ new Map();
	for (const message of prompt.messages) if (message.role === "assistant" && Array.isArray(message.content)) {
		for (const part of message.content) if (part.type === "tool-approval-request" && "approvalId" in part && "toolCallId" in part) approvalIdToToolCallId.set(part.approvalId, part.toolCallId);
	}
	const approvedToolCallIds = /* @__PURE__ */ new Set();
	for (const message of prompt.messages) if (message.role === "tool") {
		for (const part of message.content) if (part.type === "tool-approval-response") {
			const toolCallId = approvalIdToToolCallId.get(part.approvalId);
			if (toolCallId) approvedToolCallIds.add(toolCallId);
		}
	}
	const messages = [...prompt.instructions != null ? typeof prompt.instructions === "string" ? [{
		role: "system",
		content: prompt.instructions
	}] : asArray(prompt.instructions).map((message) => ({
		role: "system",
		content: message.content,
		providerOptions: message.providerOptions
	})) : [], ...prompt.messages.map((message) => convertToLanguageModelMessage({
		message,
		downloadedAssets,
		provider
	}))];
	const combinedMessages = [];
	for (const message of messages) {
		if (message.role !== "tool") {
			combinedMessages.push(message);
			continue;
		}
		const lastCombinedMessage = combinedMessages.at(-1);
		if ((lastCombinedMessage == null ? void 0 : lastCombinedMessage.role) === "tool") lastCombinedMessage.content.push(...message.content);
		else combinedMessages.push(message);
	}
	const toolCallIds = /* @__PURE__ */ new Set();
	for (const message of combinedMessages) switch (message.role) {
		case "assistant":
			for (const content of message.content) if (content.type === "tool-call" && !content.providerExecuted) toolCallIds.add(content.toolCallId);
			break;
		case "tool":
			for (const content of message.content) if (content.type === "tool-result") toolCallIds.delete(content.toolCallId);
			break;
		case "user":
		case "system":
			for (const id of approvedToolCallIds) toolCallIds.delete(id);
			if (toolCallIds.size > 0) throw new MissingToolResultsError({ toolCallIds: Array.from(toolCallIds) });
			break;
	}
	for (const id of approvedToolCallIds) toolCallIds.delete(id);
	if (toolCallIds.size > 0) throw new MissingToolResultsError({ toolCallIds: Array.from(toolCallIds) });
	return combinedMessages.filter((message) => message.role !== "tool" || message.content.length > 0);
}
function convertToLanguageModelMessage({ message, downloadedAssets, provider }) {
	const warnings = [];
	const role = message.role;
	switch (role) {
		case "system": return {
			role: "system",
			content: message.content,
			providerOptions: message.providerOptions
		};
		case "user": {
			if (typeof message.content === "string") return {
				role: "user",
				content: [{
					type: "text",
					text: message.content
				}],
				providerOptions: message.providerOptions
			};
			const converted = {
				role: "user",
				content: message.content.map((part) => {
					if (part.type === "image") warnings.push({
						type: "deprecated",
						setting: "\"image\" content part",
						message: `The "image" content part type is deprecated. Use a "file" part with mediaType: 'image' (or a more specific image/* subtype) instead.`
					});
					return convertImagePartToFilePart(part);
				}).map((part) => convertPartToLanguageModelPart(part, downloadedAssets)).filter((part) => part.type !== "text" || part.text !== ""),
				providerOptions: message.providerOptions
			};
			if (warnings.length > 0) logWarnings({ warnings });
			return converted;
		}
		case "assistant": {
			if (typeof message.content === "string") return {
				role: "assistant",
				content: [{
					type: "text",
					text: message.content
				}],
				providerOptions: message.providerOptions
			};
			const converted = {
				role: "assistant",
				content: message.content.filter((part) => part.type !== "text" || part.text !== "" || part.providerOptions != null).filter((part) => part.type !== "tool-approval-request").map((part) => {
					const providerOptions = part.providerOptions;
					switch (part.type) {
						case "custom": return {
							type: "custom",
							kind: part.kind,
							providerOptions
						};
						case "file": {
							const { data, mediaType } = convertToLanguageModelV4FilePart(part.data);
							return {
								type: "file",
								data,
								filename: part.filename,
								mediaType: mediaType != null ? mediaType : part.mediaType,
								providerOptions
							};
						}
						case "reasoning": return {
							type: "reasoning",
							text: part.text,
							providerOptions
						};
						case "reasoning-file": {
							const { data, mediaType } = convertToLanguageModelV4FilePart(part.data);
							if (data.type !== "data" && data.type !== "url") throw new Error(`Unsupported reasoning-file data type: ${data.type}`);
							return {
								type: "reasoning-file",
								data,
								mediaType: mediaType != null ? mediaType : part.mediaType,
								providerOptions
							};
						}
						case "text": return {
							type: "text",
							text: part.text,
							providerOptions
						};
						case "tool-call": return {
							type: "tool-call",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							input: part.input,
							providerExecuted: part.providerExecuted,
							providerOptions
						};
						case "tool-result": return {
							type: "tool-result",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							output: mapToolResultOutput({
								output: part.output,
								provider,
								warnings,
								downloadedAssets
							}),
							providerOptions
						};
					}
				}),
				providerOptions: message.providerOptions
			};
			if (warnings.length > 0) logWarnings({ warnings });
			return converted;
		}
		case "tool": {
			const converted = {
				role: "tool",
				content: message.content.filter((part) => part.type !== "tool-approval-response" || part.providerExecuted).map((part) => {
					switch (part.type) {
						case "tool-result": return {
							type: "tool-result",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							output: mapToolResultOutput({
								output: part.output,
								provider,
								warnings,
								downloadedAssets
							}),
							providerOptions: part.providerOptions
						};
						case "tool-approval-response": return {
							type: "tool-approval-response",
							approvalId: part.approvalId,
							approved: part.approved,
							reason: part.reason
						};
					}
				}),
				providerOptions: message.providerOptions
			};
			if (warnings.length > 0) logWarnings({ warnings });
			return converted;
		}
		default: throw new InvalidMessageRoleError({ role });
	}
}
function convertImagePartToFilePart(part) {
	var _a22;
	if (part.type !== "image") return part;
	return {
		type: "file",
		data: part.image,
		mediaType: (_a22 = part.mediaType) != null ? _a22 : "image",
		providerOptions: part.providerOptions
	};
}
async function downloadAssets(messages, download2, supportedUrls) {
	const downloadableFiles = [];
	for (const message of messages) {
		if (message.role === "user" && Array.isArray(message.content)) for (const part of message.content) {
			const filePart = convertImagePartToFilePart(part);
			if (filePart.type === "file") downloadableFiles.push(filePart);
		}
		if (message.role === "tool") for (const part of message.content) {
			if (part.type !== "tool-result") continue;
			if (part.output.type !== "content") continue;
			for (const contentPart of part.output.value) if (contentPart.type === "file") downloadableFiles.push(contentPart);
		}
		if (message.role === "assistant" && Array.isArray(message.content)) for (const part of message.content) {
			if (part.type !== "tool-result") continue;
			if (part.output.type !== "content") continue;
			for (const contentPart of part.output.value) if (contentPart.type === "file") downloadableFiles.push(contentPart);
		}
	}
	const plannedDownloads = downloadableFiles.map((part) => {
		const mediaType = part.mediaType;
		const { data } = convertToLanguageModelV4FilePart(part.data);
		return {
			mediaType,
			data
		};
	}).filter((part) => part.data.type === "url").map((part) => ({
		url: part.data.url,
		isUrlSupportedByModel: part.mediaType != null && isUrlSupported({
			url: part.data.url.toString(),
			mediaType: part.mediaType,
			supportedUrls
		})
	}));
	const downloadedFiles = await download2(plannedDownloads);
	return Object.fromEntries(downloadedFiles.map((file, index) => file == null ? null : [plannedDownloads[index].url.toString(), {
		data: file.data,
		mediaType: file.mediaType
	}]).filter((file) => file != null));
}
function convertPartToLanguageModelPart(part, downloadedAssets) {
	if (part.type === "text") return {
		type: "text",
		text: part.text,
		providerOptions: part.providerOptions
	};
	const { data: normalizedData, mediaType: dataUrlMediaType } = convertToLanguageModelV4FilePart(part.data);
	let mediaType = dataUrlMediaType != null ? dataUrlMediaType : part.mediaType;
	let data = normalizedData;
	if (data.type === "url") {
		const downloadedFile = downloadedAssets[data.url.toString()];
		if (downloadedFile) {
			data = {
				type: "data",
				data: downloadedFile.data
			};
			if (downloadedFile.mediaType != null && (mediaType == null || !isFullMediaType(mediaType))) mediaType = downloadedFile.mediaType;
		}
	}
	if (data.type === "data" && (data.data instanceof Uint8Array || typeof data.data === "string")) {
		const imageMediaType = detectMediaType({
			data: data.data,
			topLevelType: "image"
		});
		if (imageMediaType != null) mediaType = imageMediaType;
	}
	if (mediaType == null) throw new Error(`Media type is missing for file part`);
	return {
		type: "file",
		mediaType,
		filename: part.filename,
		data,
		providerOptions: part.providerOptions
	};
}
function mapToolResultOutput({ output, provider, warnings = [], downloadedAssets }) {
	if (output.type !== "content") return output;
	return {
		type: "content",
		value: output.value.map((item) => {
			var _a22;
			switch (item.type) {
				case "file": {
					const convertedPart = convertPartToLanguageModelPart(item, downloadedAssets);
					if (convertedPart.type !== "file") throw new Error("Expected tool result file content to convert to file.");
					return convertedPart;
				}
				case "file-data":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"file-data\"",
						message: `The "file-data" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'data', data } instead.`
					});
					return {
						type: "file",
						data: {
							type: "data",
							data: item.data
						},
						filename: item.filename,
						mediaType: item.mediaType,
						providerOptions: item.providerOptions
					};
				case "file-url": {
					const mediaType = (_a22 = item.mediaType) != null ? _a22 : getMediaTypeFromUrl(item.url);
					let message = `The "file-url" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'url', url } instead.`;
					if (!item.mediaType) {
						const inferenceSuffix = mediaType === "application/octet-stream" ? `Unable to infer media type from URL. Defaulting to 'application/octet-stream'.` : `Inferred media type '${mediaType}' from URL.`;
						message = `The "file-url" tool result content part with URL "${item.url}" is missing a "mediaType". ${inferenceSuffix} ${message}`;
					}
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"file-url\"",
						message
					});
					return {
						type: "file",
						data: {
							type: "url",
							url: new URL(item.url)
						},
						mediaType,
						providerOptions: item.providerOptions
					};
				}
				case "file-id":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"file-id\"",
						message: `The "file-id" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
					});
					return {
						type: "file",
						data: {
							type: "reference",
							reference: convertFileIdToProviderReference({
								fileId: item.fileId,
								provider
							})
						},
						mediaType: "application",
						providerOptions: item.providerOptions
					};
				case "file-reference":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"file-reference\"",
						message: `The "file-reference" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
					});
					return {
						type: "file",
						data: {
							type: "reference",
							reference: item.providerReference
						},
						mediaType: "application",
						providerOptions: item.providerOptions
					};
				case "image-data":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"image-data\"",
						message: `The "image-data" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'data', data } instead.`
					});
					return {
						type: "file",
						data: {
							type: "data",
							data: item.data
						},
						mediaType: item.mediaType,
						providerOptions: item.providerOptions
					};
				case "image-url":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"image-url\"",
						message: `The "image-url" type for tool result content is deprecated. Use the "file" type with mediaType 'image' (or a specific image/* subtype) and { type: 'url', url } instead.`
					});
					return {
						type: "file",
						data: {
							type: "url",
							url: new URL(item.url)
						},
						mediaType: "image",
						providerOptions: item.providerOptions
					};
				case "image-file-id":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"image-file-id\"",
						message: `The "image-file-id" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
					});
					return {
						type: "file",
						data: {
							type: "reference",
							reference: convertFileIdToProviderReference({
								fileId: item.fileId,
								provider
							})
						},
						mediaType: "image",
						providerOptions: item.providerOptions
					};
				case "image-file-reference":
					warnings.push({
						type: "deprecated",
						setting: "\"tool-result\" content of type \"image-file-reference\"",
						message: `The "image-file-reference" type for tool result content is deprecated. Use the "file" type with mediaType and { type: 'reference', reference } instead.`
					});
					return {
						type: "file",
						data: {
							type: "reference",
							reference: item.providerReference
						},
						mediaType: "image",
						providerOptions: item.providerOptions
					};
				default: return item;
			}
		})
	};
}
function convertFileIdToProviderReference({ fileId, provider }) {
	if (typeof fileId === "object") return fileId;
	if (provider == null) throw new Error("Cannot convert string fileId to provider reference without a provider ID. Use a Record<string, string> fileId or switch to the file-reference type.");
	return { [provider]: fileId };
}
var URL_EXTENSION_TO_MEDIA_TYPE = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	heic: "image/heic",
	bmp: "image/bmp",
	tiff: "image/tiff",
	tif: "image/tiff",
	pdf: "application/pdf",
	mp4: "video/mp4",
	webm: "video/webm",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg"
};
function getMediaTypeFromUrl(url, fallbackMediaType = "application/octet-stream") {
	var _a22;
	try {
		const fileExtension = (_a22 = new URL(url).pathname.split(".").pop()) == null ? void 0 : _a22.toLowerCase();
		if (fileExtension && Object.hasOwn(URL_EXTENSION_TO_MEDIA_TYPE, fileExtension)) return URL_EXTENSION_TO_MEDIA_TYPE[fileExtension];
	} catch (e) {}
	return fallbackMediaType;
}
async function createToolModelOutput({ toolCallId, input, output, tool: tool2, errorMode }) {
	if (errorMode === "text") return {
		type: "error-text",
		value: getErrorMessage(output)
	};
	else if (errorMode === "json") return {
		type: "error-json",
		value: toJSONValue(output)
	};
	if (tool2 == null ? void 0 : tool2.toModelOutput) return await tool2.toModelOutput({
		toolCallId,
		input,
		output
	});
	return typeof output === "string" ? {
		type: "text",
		value: output
	} : {
		type: "json",
		value: toJSONValue(output)
	};
}
function toJSONValue(value) {
	return value === void 0 ? null : value;
}
function prepareLanguageModelCallOptions({ maxOutputTokens, temperature, topP, topK, presencePenalty, frequencyPenalty, seed, stopSequences, reasoning }) {
	if (maxOutputTokens != null) {
		if (!Number.isInteger(maxOutputTokens)) throw new InvalidArgumentError({
			parameter: "maxOutputTokens",
			value: maxOutputTokens,
			message: "maxOutputTokens must be an integer"
		});
		if (maxOutputTokens < 1) throw new InvalidArgumentError({
			parameter: "maxOutputTokens",
			value: maxOutputTokens,
			message: "maxOutputTokens must be >= 1"
		});
	}
	if (temperature != null) {
		if (typeof temperature !== "number") throw new InvalidArgumentError({
			parameter: "temperature",
			value: temperature,
			message: "temperature must be a number"
		});
	}
	if (topP != null) {
		if (typeof topP !== "number") throw new InvalidArgumentError({
			parameter: "topP",
			value: topP,
			message: "topP must be a number"
		});
	}
	if (topK != null) {
		if (typeof topK !== "number") throw new InvalidArgumentError({
			parameter: "topK",
			value: topK,
			message: "topK must be a number"
		});
	}
	if (presencePenalty != null) {
		if (typeof presencePenalty !== "number") throw new InvalidArgumentError({
			parameter: "presencePenalty",
			value: presencePenalty,
			message: "presencePenalty must be a number"
		});
	}
	if (frequencyPenalty != null) {
		if (typeof frequencyPenalty !== "number") throw new InvalidArgumentError({
			parameter: "frequencyPenalty",
			value: frequencyPenalty,
			message: "frequencyPenalty must be a number"
		});
	}
	if (seed != null) {
		if (!Number.isInteger(seed)) throw new InvalidArgumentError({
			parameter: "seed",
			value: seed,
			message: "seed must be an integer"
		});
	}
	return {
		maxOutputTokens,
		temperature,
		topP,
		topK,
		presencePenalty,
		frequencyPenalty,
		stopSequences,
		seed,
		reasoning
	};
}
function prepareToolChoice({ toolChoice }) {
	return toolChoice == null ? { type: "auto" } : typeof toolChoice === "string" ? { type: toolChoice } : {
		type: "tool",
		toolName: toolChoice.toolName
	};
}
function isNonEmptyObject(object2) {
	return object2 != null && Object.keys(object2).length > 0;
}
async function prepareTools({ tools, toolOrder, toolsContext = {}, experimental_sandbox: sandbox }) {
	if (!isNonEmptyObject(tools)) return;
	const languageModelTools = [];
	for (const [name22, tool2] of orderToolEntries({
		tools,
		toolOrder
	})) {
		const toolType = tool2.type;
		switch (toolType) {
			case void 0:
			case "dynamic":
			case "function": {
				const description = resolveToolDescription({
					tool: tool2,
					toolName: name22,
					toolsContext,
					experimental_sandbox: sandbox
				});
				const providerOptions = tool2.providerOptions;
				const inputExamples = tool2.inputExamples;
				const strict = tool2.strict;
				languageModelTools.push({
					type: "function",
					name: name22,
					inputSchema: await asSchema(tool2.inputSchema).jsonSchema,
					...description != null ? { description } : {},
					...inputExamples != null ? { inputExamples } : {},
					...providerOptions != null ? { providerOptions } : {},
					...strict != null ? { strict } : {}
				});
				break;
			}
			case "provider":
				languageModelTools.push({
					type: "provider",
					name: name22,
					id: tool2.id,
					args: tool2.args
				});
				break;
			default: throw new Error(`Unsupported tool type: ${toolType}`);
		}
	}
	return languageModelTools;
}
function orderToolEntries({ tools, toolOrder }) {
	if (toolOrder == null) return Object.entries(tools);
	const toolEntries = Object.entries(tools);
	const orderedTools = toolEntries.filter(([name22]) => toolOrder.includes(name22)).sort(([nameA], [nameB]) => toolOrder.indexOf(nameA) - toolOrder.indexOf(nameB));
	const unorderedTools = toolEntries.filter(([name22]) => !toolOrder.includes(name22)).sort(([nameA], [nameB]) => nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
	return [...orderedTools, ...unorderedTools];
}
function resolveToolDescription({ tool: tool2, toolName, toolsContext, experimental_sandbox: sandbox }) {
	return tool2.description === void 0 ? void 0 : typeof tool2.description === "string" ? tool2.description : tool2.description({
		context: toolsContext[toolName],
		experimental_sandbox: sandbox
	});
}
function getTotalTimeoutMs(timeout) {
	if (timeout == null) return;
	if (typeof timeout === "number") return timeout;
	return timeout.totalMs;
}
function getStepTimeoutMs(timeout) {
	if (timeout == null || typeof timeout === "number") return;
	return timeout.stepMs;
}
function getToolTimeoutMs(timeout, toolName) {
	var _a22, _b;
	if (timeout == null || typeof timeout === "number") return;
	return (_b = (_a22 = timeout.tools) == null ? void 0 : _a22[`${toolName}Ms`]) != null ? _b : timeout.toolMs;
}
var jsonValueSchema = lazy(() => union([
	_null(),
	string(),
	number(),
	boolean(),
	record(string(), jsonValueSchema.optional()),
	array$1(jsonValueSchema)
]));
var providerMetadataSchema = record(string(), record(string(), jsonValueSchema.optional()));
var fileInlineDataSchema = union([
	string(),
	_instanceof(Uint8Array),
	_instanceof(ArrayBuffer),
	custom(isBuffer, { message: "Must be a Buffer" })
]);
var providerReferenceSchema = record(string(), string());
var textPartSchema = object$1({
	type: literal("text"),
	text: string(),
	providerOptions: providerMetadataSchema.optional()
});
var imagePartSchema = object$1({
	type: literal("image"),
	image: union([
		fileInlineDataSchema,
		_instanceof(URL),
		providerReferenceSchema
	]),
	mediaType: string().optional(),
	providerOptions: providerMetadataSchema.optional()
});
var taggedFileDataSchema = discriminatedUnion("type", [
	object$1({
		type: literal("data"),
		data: fileInlineDataSchema
	}),
	object$1({
		type: literal("url"),
		url: _instanceof(URL)
	}),
	object$1({
		type: literal("reference"),
		reference: providerReferenceSchema
	}),
	object$1({
		type: literal("text"),
		text: string()
	})
]);
var taggedReasoningFileDataSchema = discriminatedUnion("type", [object$1({
	type: literal("data"),
	data: fileInlineDataSchema
}), object$1({
	type: literal("url"),
	url: _instanceof(URL)
})]);
var filePartSchema = object$1({
	type: literal("file"),
	data: union([
		taggedFileDataSchema,
		fileInlineDataSchema,
		_instanceof(URL),
		providerReferenceSchema
	]),
	filename: string().optional(),
	mediaType: string(),
	providerOptions: providerMetadataSchema.optional()
});
var reasoningPartSchema = object$1({
	type: literal("reasoning"),
	text: string(),
	providerOptions: providerMetadataSchema.optional()
});
var customPartSchema = object$1({
	type: literal("custom"),
	kind: string().transform((value) => value),
	providerOptions: providerMetadataSchema.optional()
});
var reasoningFilePartSchema = object$1({
	type: literal("reasoning-file"),
	data: union([
		taggedReasoningFileDataSchema,
		fileInlineDataSchema,
		_instanceof(URL)
	]),
	mediaType: string(),
	providerOptions: providerMetadataSchema.optional()
});
var toolCallPartSchema = object$1({
	type: literal("tool-call"),
	toolCallId: string(),
	toolName: string(),
	input: unknown(),
	providerOptions: providerMetadataSchema.optional(),
	providerExecuted: boolean().optional()
});
var outputSchema = discriminatedUnion("type", [
	object$1({
		type: literal("text"),
		value: string(),
		providerOptions: providerMetadataSchema.optional()
	}),
	object$1({
		type: literal("json"),
		value: jsonValueSchema,
		providerOptions: providerMetadataSchema.optional()
	}),
	object$1({
		type: literal("execution-denied"),
		reason: string().optional(),
		providerOptions: providerMetadataSchema.optional()
	}),
	object$1({
		type: literal("error-text"),
		value: string(),
		providerOptions: providerMetadataSchema.optional()
	}),
	object$1({
		type: literal("error-json"),
		value: jsonValueSchema,
		providerOptions: providerMetadataSchema.optional()
	}),
	object$1({
		type: literal("content"),
		value: array$1(union([
			object$1({
				type: literal("text"),
				text: string(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("file"),
				data: taggedFileDataSchema,
				mediaType: string(),
				filename: string().optional(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("file-data"),
				data: string(),
				mediaType: string(),
				filename: string().optional(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("file-url"),
				url: string(),
				mediaType: string().optional(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("file-id"),
				fileId: union([string(), record(string(), string())]),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("file-reference"),
				providerReference: record(string(), string()),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("image-data"),
				data: string(),
				mediaType: string(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("image-url"),
				url: string(),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("image-file-id"),
				fileId: union([string(), record(string(), string())]),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("image-file-reference"),
				providerReference: record(string(), string()),
				providerOptions: providerMetadataSchema.optional()
			}),
			object$1({
				type: literal("custom"),
				providerOptions: providerMetadataSchema.optional()
			})
		]))
	})
]);
var toolResultPartSchema = object$1({
	type: literal("tool-result"),
	toolCallId: string(),
	toolName: string(),
	output: outputSchema,
	providerOptions: providerMetadataSchema.optional()
});
var toolApprovalRequestSchema = object$1({
	type: literal("tool-approval-request"),
	approvalId: string(),
	toolCallId: string()
});
var toolApprovalResponseSchema = object$1({
	type: literal("tool-approval-response"),
	approvalId: string(),
	approved: boolean(),
	reason: string().optional()
});
var systemModelMessageSchema = object$1({
	role: literal("system"),
	content: string(),
	providerOptions: providerMetadataSchema.optional()
});
var userModelMessageSchema = object$1({
	role: literal("user"),
	content: union([string(), array$1(union([
		textPartSchema,
		imagePartSchema,
		filePartSchema
	]))]),
	providerOptions: providerMetadataSchema.optional()
});
var assistantModelMessageSchema = object$1({
	role: literal("assistant"),
	content: union([string(), array$1(union([
		textPartSchema,
		customPartSchema,
		filePartSchema,
		reasoningPartSchema,
		reasoningFilePartSchema,
		toolCallPartSchema,
		toolResultPartSchema,
		toolApprovalRequestSchema
	]))]),
	providerOptions: providerMetadataSchema.optional()
});
var toolModelMessageSchema = object$1({
	role: literal("tool"),
	content: array$1(union([toolResultPartSchema, toolApprovalResponseSchema])),
	providerOptions: providerMetadataSchema.optional()
});
var modelMessageSchema = union([
	systemModelMessageSchema,
	userModelMessageSchema,
	assistantModelMessageSchema,
	toolModelMessageSchema
]);
async function standardizePrompt({ allowSystemInMessages = false, system, instructions = system, prompt, messages }) {
	if (prompt == null && messages == null) throw new InvalidPromptError({
		prompt,
		message: "prompt or messages must be defined"
	});
	if (prompt != null && messages != null) throw new InvalidPromptError({
		prompt,
		message: "prompt and messages cannot be defined at the same time"
	});
	if (typeof instructions !== "string" && !asArray(instructions).every((message) => message.role === "system")) throw new InvalidPromptError({
		prompt,
		message: "instructions must be a string, SystemModelMessage, or array of SystemModelMessage"
	});
	if (prompt != null && typeof prompt === "string") messages = [{
		role: "user",
		content: prompt
	}];
	else if (prompt != null && Array.isArray(prompt)) messages = prompt;
	else if (messages == null) throw new InvalidPromptError({
		prompt,
		message: "prompt or messages must be defined"
	});
	if (messages.length === 0) throw new InvalidPromptError({
		prompt,
		message: "messages must not be empty"
	});
	if (!allowSystemInMessages && messages.some((message) => message.role === "system")) throw new InvalidPromptError({
		prompt,
		message: "System messages are not allowed in the prompt or messages fields. Use the instructions option instead."
	});
	const validationResult = await safeValidateTypes({
		value: messages,
		schema: array$1(modelMessageSchema)
	});
	if (!validationResult.success) throw new InvalidPromptError({
		prompt,
		message: "The messages do not match the ModelMessage[] schema.",
		cause: validationResult.error
	});
	return {
		messages,
		instructions
	};
}
function wrapGatewayError(error) {
	if (!GatewayAuthenticationError.isInstance(error)) return error;
	const isProductionEnv = (process == null ? void 0 : "production") === "production";
	const moreInfoURL = "https://ai-sdk.dev/unauthenticated-ai-gateway";
	if (isProductionEnv) return new AISDKError({
		name: "GatewayError",
		message: `Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module. Learn more: ${moreInfoURL}`
	});
	return Object.assign(/* @__PURE__ */ new Error(`\x1B[1m\x1B[31mUnauthenticated request to AI Gateway.\x1B[0m

To authenticate, set the \x1B[33mAI_GATEWAY_API_KEY\x1B[0m environment variable with your API key.

Alternatively, you can use a provider module instead of the AI Gateway.

Learn more: \x1B[34m${moreInfoURL}\x1B[0m

`), { name: "GatewayAuthenticationError" });
}
function asLanguageModelUsage(usage) {
	return {
		inputTokens: usage.inputTokens.total,
		inputTokenDetails: {
			noCacheTokens: usage.inputTokens.noCache,
			cacheReadTokens: usage.inputTokens.cacheRead,
			cacheWriteTokens: usage.inputTokens.cacheWrite
		},
		outputTokens: usage.outputTokens.total,
		outputTokenDetails: {
			textTokens: usage.outputTokens.text,
			reasoningTokens: usage.outputTokens.reasoning
		},
		totalTokens: addTokenCounts(usage.inputTokens.total, usage.outputTokens.total),
		raw: usage.raw
	};
}
function addLanguageModelUsage(usage1, usage2) {
	var _a22, _b, _c, _d, _e, _f, _g, _h, _i, _j;
	return {
		inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
		inputTokenDetails: {
			noCacheTokens: addTokenCounts((_a22 = usage1.inputTokenDetails) == null ? void 0 : _a22.noCacheTokens, (_b = usage2.inputTokenDetails) == null ? void 0 : _b.noCacheTokens),
			cacheReadTokens: addTokenCounts((_c = usage1.inputTokenDetails) == null ? void 0 : _c.cacheReadTokens, (_d = usage2.inputTokenDetails) == null ? void 0 : _d.cacheReadTokens),
			cacheWriteTokens: addTokenCounts((_e = usage1.inputTokenDetails) == null ? void 0 : _e.cacheWriteTokens, (_f = usage2.inputTokenDetails) == null ? void 0 : _f.cacheWriteTokens)
		},
		outputTokens: addTokenCounts(usage1.outputTokens, usage2.outputTokens),
		outputTokenDetails: {
			textTokens: addTokenCounts((_g = usage1.outputTokenDetails) == null ? void 0 : _g.textTokens, (_h = usage2.outputTokenDetails) == null ? void 0 : _h.textTokens),
			reasoningTokens: addTokenCounts((_i = usage1.outputTokenDetails) == null ? void 0 : _i.reasoningTokens, (_j = usage2.outputTokenDetails) == null ? void 0 : _j.reasoningTokens)
		},
		totalTokens: addTokenCounts(usage1.totalTokens, usage2.totalTokens)
	};
}
function addTokenCounts(tokenCount1, tokenCount2) {
	return tokenCount1 == null && tokenCount2 == null ? void 0 : (tokenCount1 != null ? tokenCount1 : 0) + (tokenCount2 != null ? tokenCount2 : 0);
}
function getOwn(obj, key) {
	return obj != null && Object.hasOwn(obj, key) ? obj[key] : void 0;
}
function mergeAbortSignals(...signals) {
	const validSignals = filterNullable(...signals).map((signal) => signal instanceof AbortSignal ? signal : AbortSignal.timeout(signal));
	return validSignals.length === 0 ? void 0 : validSignals.length === 1 ? validSignals[0] : AbortSignal.any(validSignals);
}
function mergeObjects(base, overrides) {
	if (base === void 0 && overrides === void 0) return;
	if (base === void 0) return overrides;
	if (overrides === void 0) return base;
	const result = { ...base };
	for (const key in overrides) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		if (Object.prototype.hasOwnProperty.call(overrides, key)) {
			const overridesValue = overrides[key];
			if (overridesValue === void 0) continue;
			const baseValue = key in base ? base[key] : void 0;
			const isSourceObject = overridesValue !== null && typeof overridesValue === "object" && !Array.isArray(overridesValue) && !(overridesValue instanceof Date) && !(overridesValue instanceof RegExp);
			const isTargetObject = baseValue !== null && baseValue !== void 0 && typeof baseValue === "object" && !Array.isArray(baseValue) && !(baseValue instanceof Date) && !(baseValue instanceof RegExp);
			if (isSourceObject && isTargetObject) result[key] = mergeObjects(baseValue, overridesValue);
			else result[key] = overridesValue;
		}
	}
	return result;
}
function now() {
	var _a22, _b;
	return (_b = (_a22 = globalThis == null ? void 0 : globalThis.performance) == null ? void 0 : _a22.now()) != null ? _b : Date.now();
}
async function notify(options) {
	await Promise.all(asArray(options.callbacks).map(async (callback) => {
		try {
			await (callback == null ? void 0 : callback(options.event));
		} catch (e) {}
	}));
}
function getRetryDelayInMs({ error, exponentialBackoffDelay }) {
	const headers = APICallError.isInstance(error) ? error.responseHeaders : APICallError.isInstance(error.cause) ? error.cause.responseHeaders : void 0;
	if (!headers) return exponentialBackoffDelay;
	let ms;
	const retryAfterMs = headers["retry-after-ms"];
	if (retryAfterMs) {
		const timeoutMs = parseFloat(retryAfterMs);
		if (!Number.isNaN(timeoutMs)) ms = timeoutMs;
	}
	const retryAfter = headers["retry-after"];
	if (retryAfter && ms === void 0) {
		const timeoutSeconds = parseFloat(retryAfter);
		if (!Number.isNaN(timeoutSeconds)) ms = timeoutSeconds * 1e3;
		else ms = Date.parse(retryAfter) - Date.now();
	}
	if (ms != null && !Number.isNaN(ms) && 0 <= ms && (ms < 60 * 1e3 || ms < exponentialBackoffDelay)) return ms;
	return exponentialBackoffDelay;
}
var retryWithExponentialBackoffRespectingRetryHeaders = ({ maxRetries = 2, initialDelayInMs = 2e3, backoffFactor = 2, abortSignal } = {}) => retryWithExponentialBackoff({
	maxRetries,
	initialDelayInMs,
	backoffFactor,
	abortSignal,
	shouldRetry: (error) => error instanceof Error && (APICallError.isInstance(error) && error.isRetryable === true || GatewayError.isInstance(error) && error.isRetryable === true),
	getDelayInMs: ({ error, exponentialBackoffDelay }) => getRetryDelayInMs({
		error,
		exponentialBackoffDelay
	}),
	createRetryError: ({ message, reason, errors }) => new RetryError({
		message,
		reason,
		errors
	})
});
function prepareRetries({ maxRetries, abortSignal }) {
	if (maxRetries != null) {
		if (!Number.isInteger(maxRetries)) throw new InvalidArgumentError({
			parameter: "maxRetries",
			value: maxRetries,
			message: "maxRetries must be an integer"
		});
		if (maxRetries < 0) throw new InvalidArgumentError({
			parameter: "maxRetries",
			value: maxRetries,
			message: "maxRetries must be >= 0"
		});
	}
	const maxRetriesResult = maxRetries != null ? maxRetries : 2;
	return {
		maxRetries: maxRetriesResult,
		retry: retryWithExponentialBackoffRespectingRetryHeaders({
			maxRetries: maxRetriesResult,
			abortSignal
		})
	};
}
function setAbortTimeout({ abortController, label, timeoutMs }) {
	if (abortController == null || timeoutMs == null) return;
	return setTimeout(() => abortController.abort(new DOMException(`${label} timeout of ${timeoutMs}ms exceeded`, "TimeoutError")), timeoutMs);
}
function calculateTokensPerSecond({ tokens, durationMs }) {
	const tokenRate = 1e3 * (tokens != null ? tokens : 0) / (durationMs != null ? durationMs : 0);
	return Number.isFinite(tokenRate) ? tokenRate : 0;
}
function collectToolApprovals({ messages }) {
	const lastMessage = messages.at(-1);
	if ((lastMessage == null ? void 0 : lastMessage.role) != "tool") return {
		approvedToolApprovals: [],
		deniedToolApprovals: []
	};
	const toolCallsByToolCallId = /* @__PURE__ */ Object.create(null);
	for (const message of messages) if (message.role === "assistant" && typeof message.content !== "string") {
		const content = message.content;
		for (const part of content) if (part.type === "tool-call") toolCallsByToolCallId[part.toolCallId] = part;
	}
	const toolApprovalRequestsByApprovalId = /* @__PURE__ */ Object.create(null);
	for (const message of messages) if (message.role === "assistant" && typeof message.content !== "string") {
		const content = message.content;
		for (const part of content) if (part.type === "tool-approval-request") toolApprovalRequestsByApprovalId[part.approvalId] = part;
	}
	const toolResults = /* @__PURE__ */ Object.create(null);
	for (const part of lastMessage.content) if (part.type === "tool-result") toolResults[part.toolCallId] = part;
	const approvedToolApprovals = [];
	const deniedToolApprovals = [];
	const approvalResponses = lastMessage.content.filter((part) => part.type === "tool-approval-response");
	for (const approvalResponse of approvalResponses) {
		const approvalRequest = toolApprovalRequestsByApprovalId[approvalResponse.approvalId];
		if (approvalRequest == null) throw new InvalidToolApprovalError({ approvalId: approvalResponse.approvalId });
		if (toolResults[approvalRequest.toolCallId] != null) continue;
		const toolCall = toolCallsByToolCallId[approvalRequest.toolCallId];
		if (toolCall == null) throw new ToolCallNotFoundForApprovalError({
			toolCallId: approvalRequest.toolCallId,
			approvalId: approvalRequest.approvalId
		});
		const approval = {
			approvalRequest,
			approvalResponse,
			toolCall
		};
		if (approvalResponse.approved) approvedToolApprovals.push(approval);
		else deniedToolApprovals.push(approval);
	}
	return {
		approvedToolApprovals,
		deniedToolApprovals
	};
}
async function validateToolContext({ toolName, context, contextSchema }) {
	if (contextSchema == null) return context;
	return await validateTypes({
		value: context,
		schema: contextSchema,
		context: {
			field: "tool context",
			entityName: toolName
		}
	});
}
async function executeToolCall({ toolCall, tools, toolsContext, callId, messages, abortSignal, timeout, experimental_sandbox: sandbox, onPreliminaryToolResult, onToolExecutionStart, onToolExecutionEnd, executeToolInTelemetryContext = async ({ execute }) => await execute(), runInTracingChannelSpan = async ({ execute }) => await execute() }) {
	const { toolName, toolCallId, input } = toolCall;
	const tool2 = getOwn(tools, toolName);
	if (!isExecutableTool(tool2)) return;
	const context = await validateToolContext({
		toolName,
		context: getOwn(toolsContext, toolName),
		contextSchema: tool2.contextSchema
	});
	const toolExecutionContext = {
		toolCall,
		messages,
		toolContext: context
	};
	const baseCallbackEvent = {
		callId,
		...toolExecutionContext
	};
	return await runInTracingChannelSpan({
		type: "executeTool",
		event: baseCallbackEvent,
		execute: async () => {
			let output;
			await notify({
				event: baseCallbackEvent,
				callbacks: onToolExecutionStart
			});
			const toolAbortSignal = mergeAbortSignals(abortSignal, getToolTimeoutMs(timeout, toolName));
			let toolExecutionMs = 0;
			try {
				await executeToolInTelemetryContext({
					callId,
					toolCallId,
					...toolExecutionContext,
					execute: async () => {
						const startTime = now();
						try {
							const stream = executeTool({
								tool: tool2,
								input,
								options: {
									toolCallId,
									messages,
									abortSignal: toolAbortSignal,
									context,
									experimental_sandbox: sandbox
								}
							});
							for await (const part of stream) if (part.type === "preliminary") onPreliminaryToolResult?.({
								...toolCall,
								type: "tool-result",
								output: part.output,
								preliminary: true
							});
							else output = part.output;
						} finally {
							toolExecutionMs = now() - startTime;
						}
					}
				});
			} catch (error) {
				const toolError = {
					type: "tool-error",
					toolCallId,
					toolName,
					input,
					error,
					dynamic: tool2.type === "dynamic",
					...toolCall.providerMetadata != null ? { providerMetadata: toolCall.providerMetadata } : {},
					...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
				};
				await notify({
					event: {
						...baseCallbackEvent,
						toolOutput: toolError,
						toolExecutionMs
					},
					callbacks: onToolExecutionEnd
				});
				return {
					output: toolError,
					toolExecutionMs
				};
			}
			const toolResult = {
				type: "tool-result",
				toolCallId,
				toolName,
				input,
				output,
				dynamic: tool2.type === "dynamic",
				...toolCall.providerMetadata != null ? { providerMetadata: toolCall.providerMetadata } : {},
				...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
			};
			await notify({
				event: {
					...baseCallbackEvent,
					toolOutput: toolResult,
					toolExecutionMs
				},
				callbacks: onToolExecutionEnd
			});
			return {
				output: toolResult,
				toolExecutionMs
			};
		}
	});
}
function filterActiveTools({ tools, activeTools }) {
	if (tools == null || activeTools == null) return tools;
	return Object.fromEntries(Object.entries(tools).filter(([name22]) => activeTools.includes(name22)));
}
var DefaultGeneratedFile = class {
	constructor({ data, mediaType }) {
		const isUint8Array = data instanceof Uint8Array;
		this.base64Data = isUint8Array ? void 0 : data;
		this.uint8ArrayData = isUint8Array ? data : void 0;
		this.mediaType = mediaType;
	}
	get base64() {
		if (this.base64Data == null) this.base64Data = convertUint8ArrayToBase64(this.uint8ArrayData);
		return this.base64Data;
	}
	get uint8Array() {
		if (this.uint8ArrayData == null) this.uint8ArrayData = convertBase64ToUint8Array(this.base64Data);
		return this.uint8ArrayData;
	}
};
var output_exports = {};
__export(output_exports, {
	array: () => array,
	choice: () => choice,
	json: () => json,
	object: () => object,
	text: () => text
});
function fixJson(input) {
	const stack = ["ROOT"];
	let lastValidIndex = -1;
	let literalStart = null;
	let unicodeEscapeDigits = 0;
	function isHexDigit(char) {
		return char >= "0" && char <= "9" || char >= "A" && char <= "F" || char >= "a" && char <= "f";
	}
	function processValueStart(char, i, swapState) {
		switch (char) {
			case "\"":
				lastValidIndex = i;
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_STRING");
				break;
			case "f":
			case "t":
			case "n":
				lastValidIndex = i;
				literalStart = i;
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_LITERAL");
				break;
			case "-":
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_NUMBER");
				break;
			case "0":
			case "1":
			case "2":
			case "3":
			case "4":
			case "5":
			case "6":
			case "7":
			case "8":
			case "9":
				lastValidIndex = i;
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_NUMBER");
				break;
			case "{":
				lastValidIndex = i;
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_OBJECT_START");
				break;
			case "[":
				lastValidIndex = i;
				stack.pop();
				stack.push(swapState);
				stack.push("INSIDE_ARRAY_START");
				break;
		}
	}
	function processAfterObjectValue(char, i) {
		switch (char) {
			case ",":
				stack.pop();
				stack.push("INSIDE_OBJECT_AFTER_COMMA");
				break;
			case "}":
				lastValidIndex = i;
				stack.pop();
				break;
		}
	}
	function processAfterArrayValue(char, i) {
		switch (char) {
			case ",":
				stack.pop();
				stack.push("INSIDE_ARRAY_AFTER_COMMA");
				break;
			case "]":
				lastValidIndex = i;
				stack.pop();
				break;
		}
	}
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		switch (stack[stack.length - 1]) {
			case "ROOT":
				processValueStart(char, i, "FINISH");
				break;
			case "INSIDE_OBJECT_START":
				switch (char) {
					case "\"":
						stack.pop();
						stack.push("INSIDE_OBJECT_KEY");
						break;
					case "}":
						lastValidIndex = i;
						stack.pop();
						break;
				}
				break;
			case "INSIDE_OBJECT_AFTER_COMMA":
				switch (char) {
					case "\"":
						stack.pop();
						stack.push("INSIDE_OBJECT_KEY");
						break;
				}
				break;
			case "INSIDE_OBJECT_KEY":
				switch (char) {
					case "\"":
						stack.pop();
						stack.push("INSIDE_OBJECT_AFTER_KEY");
						break;
				}
				break;
			case "INSIDE_OBJECT_AFTER_KEY":
				switch (char) {
					case ":":
						stack.pop();
						stack.push("INSIDE_OBJECT_BEFORE_VALUE");
						break;
				}
				break;
			case "INSIDE_OBJECT_BEFORE_VALUE":
				processValueStart(char, i, "INSIDE_OBJECT_AFTER_VALUE");
				break;
			case "INSIDE_OBJECT_AFTER_VALUE":
				processAfterObjectValue(char, i);
				break;
			case "INSIDE_STRING":
				switch (char) {
					case "\"":
						stack.pop();
						lastValidIndex = i;
						break;
					case "\\":
						stack.push("INSIDE_STRING_ESCAPE");
						break;
					default: lastValidIndex = i;
				}
				break;
			case "INSIDE_ARRAY_START":
				switch (char) {
					case "]":
						lastValidIndex = i;
						stack.pop();
						break;
					default:
						lastValidIndex = i;
						processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
						break;
				}
				break;
			case "INSIDE_ARRAY_AFTER_VALUE":
				switch (char) {
					case ",":
						stack.pop();
						stack.push("INSIDE_ARRAY_AFTER_COMMA");
						break;
					case "]":
						lastValidIndex = i;
						stack.pop();
						break;
					default:
						lastValidIndex = i;
						break;
				}
				break;
			case "INSIDE_ARRAY_AFTER_COMMA":
				processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
				break;
			case "INSIDE_STRING_ESCAPE":
				stack.pop();
				if (char === "u") {
					unicodeEscapeDigits = 0;
					stack.push("INSIDE_STRING_UNICODE_ESCAPE");
				} else lastValidIndex = i;
				break;
			case "INSIDE_STRING_UNICODE_ESCAPE":
				if (isHexDigit(char)) {
					unicodeEscapeDigits++;
					if (unicodeEscapeDigits === 4) {
						stack.pop();
						lastValidIndex = i;
					}
				}
				break;
			case "INSIDE_NUMBER":
				switch (char) {
					case "0":
					case "1":
					case "2":
					case "3":
					case "4":
					case "5":
					case "6":
					case "7":
					case "8":
					case "9":
						lastValidIndex = i;
						break;
					case "e":
					case "E":
					case "-":
					case ".": break;
					case ",":
						stack.pop();
						if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") processAfterArrayValue(char, i);
						if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") processAfterObjectValue(char, i);
						break;
					case "}":
						stack.pop();
						if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") processAfterObjectValue(char, i);
						break;
					case "]":
						stack.pop();
						if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") processAfterArrayValue(char, i);
						break;
					default:
						stack.pop();
						break;
				}
				break;
			case "INSIDE_LITERAL": {
				const partialLiteral = input.substring(literalStart, i + 1);
				if (!"false".startsWith(partialLiteral) && !"true".startsWith(partialLiteral) && !"null".startsWith(partialLiteral)) {
					stack.pop();
					if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") processAfterObjectValue(char, i);
					else if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") processAfterArrayValue(char, i);
				} else lastValidIndex = i;
				break;
			}
		}
	}
	let result = input.slice(0, lastValidIndex + 1);
	for (let i = stack.length - 1; i >= 0; i--) switch (stack[i]) {
		case "INSIDE_STRING":
			result += "\"";
			break;
		case "INSIDE_OBJECT_KEY":
		case "INSIDE_OBJECT_AFTER_KEY":
		case "INSIDE_OBJECT_AFTER_COMMA":
		case "INSIDE_OBJECT_START":
		case "INSIDE_OBJECT_BEFORE_VALUE":
		case "INSIDE_OBJECT_AFTER_VALUE":
			result += "}";
			break;
		case "INSIDE_ARRAY_START":
		case "INSIDE_ARRAY_AFTER_COMMA":
		case "INSIDE_ARRAY_AFTER_VALUE":
			result += "]";
			break;
		case "INSIDE_LITERAL": {
			const partialLiteral = input.substring(literalStart, input.length);
			if ("true".startsWith(partialLiteral)) result += "true".slice(partialLiteral.length);
			else if ("false".startsWith(partialLiteral)) result += "false".slice(partialLiteral.length);
			else if ("null".startsWith(partialLiteral)) result += "null".slice(partialLiteral.length);
		}
	}
	return result;
}
async function parsePartialJson(jsonText) {
	if (jsonText === void 0) return {
		value: void 0,
		state: "undefined-input"
	};
	let result = await safeParseJSON({ text: jsonText });
	if (result.success) return {
		value: result.value,
		state: "successful-parse"
	};
	result = await safeParseJSON({ text: fixJson(jsonText) });
	if (result.success) return {
		value: result.value,
		state: "repaired-parse"
	};
	return {
		value: void 0,
		state: "failed-parse"
	};
}
var text = () => ({
	name: "text",
	responseFormat: Promise.resolve({ type: "text" }),
	async parseCompleteOutput({ text: text2 }) {
		return text2;
	},
	async parsePartialOutput({ text: text2 }) {
		return { partial: text2 };
	},
	createElementStreamTransform() {}
});
var object = ({ schema: inputSchema, name: name22, description }) => {
	const schema = asSchema(inputSchema);
	return {
		name: "object",
		responseFormat: resolve(schema.jsonSchema).then((jsonSchema2) => ({
			type: "json",
			schema: jsonSchema2,
			...name22 != null && { name: name22 },
			...description != null && { description }
		})),
		async parseCompleteOutput({ text: text2 }, context) {
			const parseResult = await safeParseJSON({ text: text2 });
			if (!parseResult.success) throw new NoObjectGeneratedError({
				message: "No object generated: could not parse the response.",
				cause: parseResult.error,
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			const validationResult = await safeValidateTypes({
				value: parseResult.value,
				schema
			});
			if (!validationResult.success) throw new NoObjectGeneratedError({
				message: "No object generated: response did not match schema.",
				cause: validationResult.error,
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			return validationResult.value;
		},
		async parsePartialOutput({ text: text2 }) {
			const result = await parsePartialJson(text2);
			switch (result.state) {
				case "failed-parse":
				case "undefined-input": return;
				case "repaired-parse":
				case "successful-parse": return { partial: result.value };
			}
		},
		createElementStreamTransform() {}
	};
};
var array = ({ element: inputElementSchema, name: name22, description }) => {
	const elementSchema = asSchema(inputElementSchema);
	return {
		name: "array",
		responseFormat: resolve(elementSchema.jsonSchema).then((jsonSchema2) => {
			const { $schema: _$schema, ...itemSchema } = jsonSchema2;
			return {
				type: "json",
				schema: {
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					properties: { elements: {
						type: "array",
						items: itemSchema
					} },
					required: ["elements"],
					additionalProperties: false
				},
				...name22 != null && { name: name22 },
				...description != null && { description }
			};
		}),
		async parseCompleteOutput({ text: text2 }, context) {
			const parseResult = await safeParseJSON({ text: text2 });
			if (!parseResult.success) throw new NoObjectGeneratedError({
				message: "No object generated: could not parse the response.",
				cause: parseResult.error,
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			const outerValue = parseResult.value;
			if (outerValue == null || typeof outerValue !== "object" || !("elements" in outerValue) || !Array.isArray(outerValue.elements)) throw new NoObjectGeneratedError({
				message: "No object generated: response did not match schema.",
				cause: new TypeValidationError({
					value: outerValue,
					cause: "response must be an object with an elements array"
				}),
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			const validatedElements = [];
			for (const element of outerValue.elements) {
				const validationResult = await safeValidateTypes({
					value: element,
					schema: elementSchema
				});
				if (!validationResult.success) throw new NoObjectGeneratedError({
					message: "No object generated: response did not match schema.",
					cause: validationResult.error,
					text: text2,
					response: context.response,
					usage: context.usage,
					finishReason: context.finishReason
				});
				validatedElements.push(validationResult.value);
			}
			return validatedElements;
		},
		async parsePartialOutput({ text: text2 }) {
			const result = await parsePartialJson(text2);
			switch (result.state) {
				case "failed-parse":
				case "undefined-input": return;
				case "repaired-parse":
				case "successful-parse": {
					const outerValue = result.value;
					if (outerValue == null || typeof outerValue !== "object" || !("elements" in outerValue) || !Array.isArray(outerValue.elements)) return;
					const rawElements = result.state === "repaired-parse" && outerValue.elements.length > 0 ? outerValue.elements.slice(0, -1) : outerValue.elements;
					const parsedElements = [];
					for (const rawElement of rawElements) {
						const validationResult = await safeValidateTypes({
							value: rawElement,
							schema: elementSchema
						});
						if (validationResult.success) parsedElements.push(validationResult.value);
					}
					return { partial: parsedElements };
				}
			}
		},
		createElementStreamTransform() {
			let publishedElements = 0;
			return new TransformStream({ transform({ partialOutput }, controller) {
				if (partialOutput != null) for (; publishedElements < partialOutput.length; publishedElements++) controller.enqueue(partialOutput[publishedElements]);
			} });
		}
	};
};
var choice = ({ options: choiceOptions, name: name22, description }) => {
	return {
		name: "choice",
		responseFormat: Promise.resolve({
			type: "json",
			schema: {
				$schema: "http://json-schema.org/draft-07/schema#",
				type: "object",
				properties: { result: {
					type: "string",
					enum: choiceOptions
				} },
				required: ["result"],
				additionalProperties: false
			},
			...name22 != null && { name: name22 },
			...description != null && { description }
		}),
		async parseCompleteOutput({ text: text2 }, context) {
			const parseResult = await safeParseJSON({ text: text2 });
			if (!parseResult.success) throw new NoObjectGeneratedError({
				message: "No object generated: could not parse the response.",
				cause: parseResult.error,
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			const outerValue = parseResult.value;
			if (outerValue == null || typeof outerValue !== "object" || !("result" in outerValue) || typeof outerValue.result !== "string" || !choiceOptions.includes(outerValue.result)) throw new NoObjectGeneratedError({
				message: "No object generated: response did not match schema.",
				cause: new TypeValidationError({
					value: outerValue,
					cause: "response must be an object that contains a choice value."
				}),
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			return outerValue.result;
		},
		async parsePartialOutput({ text: text2 }) {
			const result = await parsePartialJson(text2);
			switch (result.state) {
				case "failed-parse":
				case "undefined-input": return;
				case "repaired-parse":
				case "successful-parse": {
					const outerValue = result.value;
					if (outerValue == null || typeof outerValue !== "object" || !("result" in outerValue) || typeof outerValue.result !== "string") return;
					const potentialMatches = choiceOptions.filter((choiceOption) => choiceOption.startsWith(outerValue.result));
					if (result.state === "successful-parse") return potentialMatches.includes(outerValue.result) ? { partial: outerValue.result } : void 0;
					else return potentialMatches.length === 1 ? { partial: potentialMatches[0] } : void 0;
				}
			}
		},
		createElementStreamTransform() {}
	};
};
var json = ({ name: name22, description } = {}) => {
	return {
		name: "json",
		responseFormat: Promise.resolve({
			type: "json",
			...name22 != null && { name: name22 },
			...description != null && { description }
		}),
		async parseCompleteOutput({ text: text2 }, context) {
			const parseResult = await safeParseJSON({ text: text2 });
			if (!parseResult.success) throw new NoObjectGeneratedError({
				message: "No object generated: could not parse the response.",
				cause: parseResult.error,
				text: text2,
				response: context.response,
				usage: context.usage,
				finishReason: context.finishReason
			});
			return parseResult.value;
		},
		async parsePartialOutput({ text: text2 }) {
			const result = await parsePartialJson(text2);
			switch (result.state) {
				case "failed-parse":
				case "undefined-input": return;
				case "repaired-parse":
				case "successful-parse": return result.value === void 0 ? void 0 : { partial: result.value };
			}
		},
		createElementStreamTransform() {}
	};
};
async function parseToolCall({ toolCall, tools, repairToolCall, refineToolInput, messages, instructions }) {
	try {
		if (tools == null) {
			if (toolCall.providerExecuted && toolCall.dynamic) return await refineParsedToolCallInput({
				toolCall: await parseProviderExecutedDynamicToolCall(toolCall),
				refineToolInput
			});
			throw new NoSuchToolError({ toolName: toolCall.toolName });
		}
		try {
			return await refineParsedToolCallInput({
				toolCall: await doParseToolCall({
					toolCall,
					tools
				}),
				refineToolInput
			});
		} catch (error) {
			if (repairToolCall == null || !(NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error))) throw error;
			let repairedToolCall = null;
			try {
				repairedToolCall = await repairToolCall({
					toolCall,
					tools,
					inputSchema: async ({ toolName }) => {
						var _a22;
						return await asSchema((_a22 = getOwn(tools, toolName)) == null ? void 0 : _a22.inputSchema).jsonSchema;
					},
					instructions,
					system: instructions,
					messages,
					error
				});
			} catch (repairError) {
				throw new ToolCallRepairError({
					cause: repairError,
					originalError: error
				});
			}
			if (repairedToolCall == null) throw error;
			return await refineParsedToolCallInput({
				toolCall: await doParseToolCall({
					toolCall: repairedToolCall,
					tools
				}),
				refineToolInput
			});
		}
	} catch (error) {
		const parsedInput = await safeParseJSON({ text: toolCall.input });
		const input = parsedInput.success ? parsedInput.value : toolCall.input;
		const tool2 = getOwn(tools, toolCall.toolName);
		return {
			type: "tool-call",
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input,
			dynamic: true,
			invalid: true,
			error,
			title: tool2 == null ? void 0 : tool2.title,
			providerExecuted: toolCall.providerExecuted,
			providerMetadata: toolCall.providerMetadata,
			...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
		};
	}
}
async function refineParsedToolCallInput({ toolCall, refineToolInput }) {
	const refine = getOwn(refineToolInput, toolCall.toolName);
	if (refine == null) return toolCall;
	return {
		...toolCall,
		input: await refine(toolCall.input)
	};
}
async function parseProviderExecutedDynamicToolCall(toolCall) {
	const parseResult = toolCall.input.trim() === "" ? {
		success: true,
		value: {}
	} : await safeParseJSON({ text: toolCall.input });
	if (parseResult.success === false) throw new InvalidToolInputError({
		toolName: toolCall.toolName,
		toolInput: toolCall.input,
		cause: parseResult.error
	});
	return {
		type: "tool-call",
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
		input: parseResult.value,
		providerExecuted: true,
		dynamic: true,
		providerMetadata: toolCall.providerMetadata
	};
}
async function doParseToolCall({ toolCall, tools }) {
	const toolName = toolCall.toolName;
	const tool2 = getOwn(tools, toolName);
	if (tool2 == null) {
		if (toolCall.providerExecuted && toolCall.dynamic) return await parseProviderExecutedDynamicToolCall(toolCall);
		throw new NoSuchToolError({
			toolName: toolCall.toolName,
			availableTools: Object.keys(tools)
		});
	}
	const schema = asSchema(tool2.inputSchema);
	const parseResult = toolCall.input.trim() === "" ? await safeValidateTypes({
		value: {},
		schema
	}) : await safeParseJSON({
		text: toolCall.input,
		schema
	});
	if (parseResult.success === false) throw new InvalidToolInputError({
		toolName,
		toolInput: toolCall.input,
		cause: parseResult.error
	});
	return tool2.type === "dynamic" ? {
		type: "tool-call",
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
		input: parseResult.value,
		providerExecuted: toolCall.providerExecuted,
		providerMetadata: toolCall.providerMetadata,
		...tool2.metadata != null ? { toolMetadata: tool2.metadata } : {},
		dynamic: true,
		title: tool2.title
	} : {
		type: "tool-call",
		toolCallId: toolCall.toolCallId,
		toolName,
		input: parseResult.value,
		providerExecuted: toolCall.providerExecuted,
		providerMetadata: toolCall.providerMetadata,
		...tool2.metadata != null ? { toolMetadata: tool2.metadata } : {},
		title: tool2.title
	};
}
function unwrapReasoningFileData(data) {
	if (typeof data === "object" && data !== null && "type" in data) return data.type === "data" ? data.data : data.url;
	return data;
}
function convertFromReasoningOutputs(parts) {
	return parts.map((part) => {
		if (part.type === "reasoning") return {
			type: "reasoning",
			text: part.text,
			...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
		};
		return {
			type: "reasoning-file",
			data: part.file.base64,
			mediaType: part.file.mediaType,
			...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
		};
	});
}
function convertToReasoningOutputs(parts) {
	return parts.map((part) => {
		if (part.type === "reasoning") return {
			type: "reasoning",
			text: part.text,
			...part.providerOptions != null ? { providerMetadata: part.providerOptions } : {}
		};
		const rawData = unwrapReasoningFileData(part.data);
		return {
			type: "reasoning-file",
			file: new DefaultGeneratedFile({
				data: rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData instanceof URL ? rawData.toString() : rawData,
				mediaType: part.mediaType
			}),
			...part.providerOptions != null ? { providerMetadata: part.providerOptions } : {}
		};
	});
}
async function resolveToolApproval({ tools, toolCall, toolApproval, messages, toolsContext, runtimeContext }) {
	if (toolApproval != null && typeof toolApproval === "function") return normalizeToolApprovalStatus(await toolApproval({
		toolCall,
		tools,
		toolsContext,
		messages,
		runtimeContext
	}));
	const toolName = toolCall.toolName;
	const tool2 = getOwn(tools, toolName);
	const input = toolCall.input;
	const userDefinedToolApprovalStatus = getOwn(toolApproval, toolName);
	if (userDefinedToolApprovalStatus != null) return normalizeToolApprovalStatus(typeof userDefinedToolApprovalStatus === "function" ? await userDefinedToolApprovalStatus(input, {
		toolCallId: toolCall.toolCallId,
		messages,
		toolContext: await validateToolContext({
			toolName,
			context: getOwn(toolsContext, toolName),
			contextSchema: tool2 == null ? void 0 : tool2.contextSchema
		}),
		runtimeContext
	}) : userDefinedToolApprovalStatus);
	if ((tool2 == null ? void 0 : tool2.needsApproval) == null) return { type: "not-applicable" };
	return (typeof tool2.needsApproval === "function" ? await tool2.needsApproval(input, {
		toolCallId: toolCall.toolCallId,
		messages,
		context: await validateToolContext({
			toolName,
			context: getOwn(toolsContext, toolName),
			contextSchema: tool2 == null ? void 0 : tool2.contextSchema
		})
	}) : tool2.needsApproval) ? { type: "user-approval" } : { type: "not-applicable" };
}
function normalizeToolApprovalStatus(status) {
	return status === void 0 ? { type: "not-applicable" } : typeof status === "string" ? { type: status } : status;
}
function mergeCallbacks(...callbacks) {
	return async (event) => {
		await Promise.allSettled(callbacks.map(async (callback) => {
			await (callback == null ? void 0 : callback(event));
		}));
	};
}
var AI_SDK_TELEMETRY_TRACING_CHANNEL = "ai:telemetry";
function isNodeRuntime() {
	var _a22;
	return typeof process !== "undefined" && ((_a22 = process.release) == null ? void 0 : _a22.name) === "node";
}
var diagnosticsChannelPromise;
async function loadDiagnosticsChannel() {
	if (!isNodeRuntime()) return;
	if (diagnosticsChannelPromise == null) diagnosticsChannelPromise = Promise.resolve(loadBuiltinModule("node:diagnostics_channel"));
	return diagnosticsChannelPromise;
}
function loadBuiltinModule(id) {
	var _a22;
	const processWithBuiltins = globalThis.process;
	try {
		return (_a22 = processWithBuiltins == null ? void 0 : processWithBuiltins.getBuiltinModule) == null ? void 0 : _a22.call(processWithBuiltins, id);
	} catch (e) {
		return;
	}
}
async function runWithTracingChannelSpan(message, execute) {
	var _a22;
	const diagnosticsChannel = await loadDiagnosticsChannel();
	const tracingChannel = (_a22 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a22.call(diagnosticsChannel, AI_SDK_TELEMETRY_TRACING_CHANNEL);
	if (tracingChannel == null || tracingChannel.hasSubscribers === false) return await execute();
	let executePromise;
	let executionResult;
	let executionError;
	let hasExecutionResult = false;
	let hasExecutionError = false;
	const tracedExecute = () => {
		try {
			executePromise = Promise.resolve(execute());
		} catch (error) {
			executePromise = Promise.reject(error);
		}
		executePromise = executePromise.then((result) => {
			executionResult = result;
			hasExecutionResult = true;
			return result;
		}, (error) => {
			executionError = error;
			hasExecutionError = true;
			throw error;
		});
		return executePromise;
	};
	try {
		return await tracingChannel.tracePromise(tracedExecute, message);
	} catch (e) {
		if (hasExecutionError) throw executionError;
		if (hasExecutionResult) return executionResult;
		if (executePromise != null) return await executePromise;
		return await execute();
	}
}
function openTelemetryChannelSpanContext({ message, completion }) {
	var _a22;
	if (!isNodeRuntime()) return;
	const diagnosticsChannel = loadBuiltinModule("node:diagnostics_channel");
	const asyncHooks = loadBuiltinModule("node:async_hooks");
	const tracingChannel = (_a22 = diagnosticsChannel == null ? void 0 : diagnosticsChannel.tracingChannel) == null ? void 0 : _a22.call(diagnosticsChannel, AI_SDK_TELEMETRY_TRACING_CHANNEL);
	if (tracingChannel == null || tracingChannel.hasSubscribers === false || asyncHooks == null) {
		Promise.resolve(completion).catch(() => {});
		return;
	}
	const context = message;
	let asyncResource;
	let asyncEndPublished = false;
	const safePublish = (publish) => {
		try {
			publish();
		} catch (e) {}
	};
	const publishAsyncEnd = ({ result, error }) => {
		if (asyncEndPublished) return;
		asyncEndPublished = true;
		if (error !== void 0) {
			context.error = error;
			safePublish(() => tracingChannel.error.publish(context));
		}
		if (result !== void 0) context.result = result;
		safePublish(() => tracingChannel.asyncEnd.publish(context));
	};
	safePublish(() => {
		tracingChannel.start.runStores(context, () => {
			asyncResource = new asyncHooks.AsyncResource("ai.telemetry");
		});
	});
	safePublish(() => tracingChannel.end.publish(context));
	Promise.resolve(completion).then((result) => publishAsyncEnd({ result }), (error) => publishAsyncEnd({ error }));
	return { run: (execute) => asyncResource == null ? execute() : asyncResource.runInAsyncScope(execute) };
}
function getGlobalTelemetryIntegrations() {
	var _a22;
	return (_a22 = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS) != null ? _a22 : [];
}
function augmentEvent(event, telemetry) {
	return Object.assign(Object.create(Object.getPrototypeOf(event)), event, telemetry);
}
function createTelemetryDispatcher({ telemetry }) {
	if ((telemetry == null ? void 0 : telemetry.isEnabled) === false) return {};
	const localIntegrations = telemetry == null ? void 0 : telemetry.integrations;
	const integrations = localIntegrations != null ? asArray(localIntegrations) : getGlobalTelemetryIntegrations();
	const telemetryMetadata = {
		recordInputs: telemetry == null ? void 0 : telemetry.recordInputs,
		recordOutputs: telemetry == null ? void 0 : telemetry.recordOutputs,
		functionId: telemetry == null ? void 0 : telemetry.functionId
	};
	const mergeTelemetryCallback = (key) => {
		const mergedIntegrationCallback = mergeCallbacks(...integrations.map((integration) => {
			var _a22;
			return (_a22 = integration[key]) == null ? void 0 : _a22.bind(integration);
		}).filter(Boolean).map((callback) => (event) => callback(augmentEvent(event, telemetryMetadata))));
		return async (event) => {
			await mergedIntegrationCallback(event);
		};
	};
	const executeLanguageModelCallWrappers = integrations.map((integration) => {
		var _a22;
		return (_a22 = integration.executeLanguageModelCall) == null ? void 0 : _a22.bind(integration);
	}).filter(Boolean);
	const executeToolWrappers = integrations.map((integration) => {
		var _a22;
		return (_a22 = integration.executeTool) == null ? void 0 : _a22.bind(integration);
	}).filter(Boolean);
	return {
		runInTracingChannelSpan: async ({ type, event, execute }) => await runWithTracingChannelSpan({
			type,
			event: augmentEvent(event, telemetryMetadata)
		}, execute),
		startTracingChannelContext: ({ type, event, completion }) => openTelemetryChannelSpanContext({
			message: {
				type,
				event: augmentEvent(event, telemetryMetadata)
			},
			completion
		}),
		onStart: mergeTelemetryCallback("onStart"),
		onStepStart: mergeTelemetryCallback("onStepStart"),
		onLanguageModelCallStart: mergeTelemetryCallback("onLanguageModelCallStart"),
		onLanguageModelCallEnd: mergeTelemetryCallback("onLanguageModelCallEnd"),
		onToolExecutionStart: mergeTelemetryCallback("onToolExecutionStart"),
		onToolExecutionEnd: mergeTelemetryCallback("onToolExecutionEnd"),
		onStepEnd: mergeCallbacks(mergeTelemetryCallback("onStepEnd"), mergeTelemetryCallback("onStepFinish")),
		onObjectStepStart: mergeTelemetryCallback("onObjectStepStart"),
		onObjectStepEnd: mergeTelemetryCallback("onObjectStepEnd"),
		onEmbedStart: mergeTelemetryCallback("onEmbedStart"),
		onEmbedEnd: mergeTelemetryCallback("onEmbedEnd"),
		onRerankStart: mergeTelemetryCallback("onRerankStart"),
		onRerankEnd: mergeTelemetryCallback("onRerankEnd"),
		onEnd: mergeTelemetryCallback("onEnd"),
		onAbort: mergeTelemetryCallback("onAbort"),
		onError: mergeTelemetryCallback("onError"),
		/**
		* Runs provider calls inside integration-specific context so
		* auto-instrumented provider requests can be associated with model work.
		*/
		executeLanguageModelCall: async ({ execute, ...event }) => {
			const augmentedEvent = augmentEvent(event, telemetryMetadata);
			let wrappedExecute = execute;
			for (const executeWrapper of executeLanguageModelCallWrappers) {
				const innerExecute = wrappedExecute;
				wrappedExecute = () => executeWrapper({
					...augmentedEvent,
					execute: innerExecute
				});
			}
			return await runWithTracingChannelSpan({
				type: "languageModelCall",
				event: augmentedEvent
			}, wrappedExecute);
		},
		/**
		* Composes all `executeTool` wrappers around the original tool execution.
		* Each wrapper receives an `execute` function that calls the next wrapper in
		* the chain, so integrations can establish nested telemetry context before
		* delegating to the underlying tool.
		*/
		executeTool: async ({ execute, ...event }) => {
			const augmentedEvent = augmentEvent(event, telemetryMetadata);
			let wrappedExecute = execute;
			for (const executeWrapper of executeToolWrappers) {
				const innerExecute = wrappedExecute;
				wrappedExecute = () => executeWrapper({
					...augmentedEvent,
					execute: innerExecute
				});
			}
			return await wrappedExecute();
		}
	};
}
function asReasoningText(reasoningParts) {
	const reasoningText = reasoningParts.map((part) => "text" in part ? part.text : "").join("");
	return reasoningText.length > 0 ? reasoningText : void 0;
}
var DefaultStepResult = class {
	constructor({ callId, stepNumber, provider, modelId, runtimeContext, toolsContext, content, finishReason, rawFinishReason, usage, performance, warnings, request, response, providerMetadata }) {
		this.callId = callId;
		this.stepNumber = stepNumber;
		this.model = {
			provider,
			modelId
		};
		this.runtimeContext = runtimeContext;
		this.toolsContext = toolsContext;
		this.content = content;
		this.finishReason = finishReason;
		this.rawFinishReason = rawFinishReason;
		this.usage = usage;
		this.performance = performance;
		this.warnings = warnings;
		this.request = request;
		this.response = response;
		this.providerMetadata = providerMetadata;
	}
	get text() {
		return this.content.filter((part) => part.type === "text").map((part) => part.text).join("");
	}
	get reasoning() {
		return convertFromReasoningOutputs(this.content.filter((part) => part.type === "reasoning" || part.type === "reasoning-file"));
	}
	get reasoningText() {
		return asReasoningText(this.reasoning);
	}
	get files() {
		return this.content.filter((part) => part.type === "file").map((part) => part.file);
	}
	get sources() {
		return this.content.filter((part) => part.type === "source");
	}
	get toolCalls() {
		return this.content.filter((part) => part.type === "tool-call");
	}
	get staticToolCalls() {
		return this.toolCalls.filter((toolCall) => toolCall.dynamic !== true);
	}
	get dynamicToolCalls() {
		return this.toolCalls.filter((toolCall) => toolCall.dynamic === true);
	}
	get toolResults() {
		return this.content.filter((part) => part.type === "tool-result");
	}
	get staticToolResults() {
		return this.toolResults.filter((toolResult) => toolResult.dynamic !== true);
	}
	get dynamicToolResults() {
		return this.toolResults.filter((toolResult) => toolResult.dynamic === true);
	}
};
function filterIncludedContext({ context, includeContext }) {
	if (context == null) return {};
	return Object.fromEntries(Object.entries(context).filter(([key]) => (includeContext == null ? void 0 : includeContext[key]) === true));
}
function restrictStepResult({ step, includeRuntimeContext, includeToolsContext }) {
	return new DefaultStepResult({
		callId: step.callId,
		stepNumber: step.stepNumber,
		provider: step.model.provider,
		modelId: step.model.modelId,
		runtimeContext: filterIncludedContext({
			context: step.runtimeContext,
			includeContext: includeRuntimeContext
		}),
		toolsContext: filterToolsContext({
			toolsContext: step.toolsContext,
			includeToolsContext
		}),
		content: step.content,
		finishReason: step.finishReason,
		rawFinishReason: step.rawFinishReason,
		usage: step.usage,
		performance: step.performance,
		warnings: step.warnings,
		request: step.request,
		response: step.response,
		providerMetadata: step.providerMetadata
	});
}
function filterToolsContext({ toolsContext, includeToolsContext }) {
	if (includeToolsContext == null) return {};
	return Object.fromEntries(Object.entries(toolsContext).map(([toolName, toolContext]) => [toolName, filterToolContext({
		toolName,
		toolContext,
		includeToolsContext
	})]));
}
function filterToolContext({ toolName, toolContext, includeToolsContext }) {
	return filterIncludedContext({
		context: toolContext,
		includeContext: includeToolsContext == null ? void 0 : includeToolsContext[toolName]
	});
}
function createRestrictedTelemetryDispatcher({ telemetry, includeRuntimeContext, includeToolsContext }) {
	const telemetryDispatcher = createTelemetryDispatcher({ telemetry });
	return {
		...telemetryDispatcher,
		onStart: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
				...event,
				runtimeContext: filterIncludedContext({
					context: event.runtimeContext,
					includeContext: includeRuntimeContext
				}),
				toolsContext: filterToolsContext({
					toolsContext: event.toolsContext,
					includeToolsContext
				})
			});
		},
		onStepStart: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onStepStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
				...event,
				runtimeContext: filterIncludedContext({
					context: event.runtimeContext,
					includeContext: includeRuntimeContext
				}),
				steps: event.steps.map((step) => restrictStepResult({
					step,
					includeRuntimeContext,
					includeToolsContext
				})),
				toolsContext: filterToolsContext({
					toolsContext: event.toolsContext,
					includeToolsContext
				})
			});
		},
		onStepEnd: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a22.call(telemetryDispatcher, restrictStepResult({
				step: event,
				includeRuntimeContext,
				includeToolsContext
			}));
		},
		onStepFinish: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onStepEnd) == null ? void 0 : _a22.call(telemetryDispatcher, restrictStepResult({
				step: event,
				includeRuntimeContext,
				includeToolsContext
			}));
		},
		onEnd: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onEnd) == null ? void 0 : _a22.call(telemetryDispatcher, ((restrictedSteps) => {
				return {
					...event,
					runtimeContext: filterIncludedContext({
						context: event.runtimeContext,
						includeContext: includeRuntimeContext
					}),
					steps: restrictedSteps,
					finalStep: restrictedSteps.at(-1),
					toolsContext: filterToolsContext({
						toolsContext: event.toolsContext,
						includeToolsContext
					})
				};
			})(event.steps.map((step) => restrictStepResult({
				step,
				includeRuntimeContext,
				includeToolsContext
			}))));
		},
		onAbort: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onAbort) == null ? void 0 : _a22.call(telemetryDispatcher, {
				...event,
				steps: event.steps.map((step) => restrictStepResult({
					step,
					includeRuntimeContext,
					includeToolsContext
				}))
			});
		},
		onToolExecutionStart: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onToolExecutionStart) == null ? void 0 : _a22.call(telemetryDispatcher, {
				...event,
				toolContext: filterToolContext({
					toolName: event.toolCall.toolName,
					toolContext: event.toolContext,
					includeToolsContext
				})
			});
		},
		onToolExecutionEnd: (event) => {
			var _a22;
			return (_a22 = telemetryDispatcher.onToolExecutionEnd) == null ? void 0 : _a22.call(telemetryDispatcher, {
				...event,
				toolContext: filterToolContext({
					toolName: event.toolCall.toolName,
					toolContext: event.toolContext,
					includeToolsContext
				})
			});
		}
	};
}
function isStepCount(stepCount) {
	return ({ steps }) => steps.length === stepCount;
}
async function isStopConditionMet({ stopConditions, steps }) {
	return (await Promise.all(stopConditions.map((condition) => condition({ steps })))).some((result) => result);
}
function sumTokenCounts(tokenCount1, tokenCount2) {
	return tokenCount1 == null && tokenCount2 == null ? void 0 : (tokenCount1 != null ? tokenCount1 : 0) + (tokenCount2 != null ? tokenCount2 : 0);
}
async function toResponseMessages({ content: inputContent, tools }) {
	const responseMessages = [];
	const toolCallOrder = /* @__PURE__ */ new Map();
	const content = [];
	for (const part of inputContent) {
		if (part.type === "source") continue;
		if ((part.type === "tool-result" || part.type === "tool-error") && !part.providerExecuted) continue;
		if (part.type === "text" && part.text.length === 0) continue;
		switch (part.type) {
			case "text":
				content.push({
					type: "text",
					text: part.text,
					providerOptions: part.providerMetadata
				});
				break;
			case "custom":
				content.push({
					type: "custom",
					kind: part.kind,
					providerOptions: part.providerMetadata
				});
				break;
			case "reasoning":
				content.push({
					type: "reasoning",
					text: part.text,
					providerOptions: part.providerMetadata
				});
				break;
			case "file":
				content.push({
					type: "file",
					data: part.file.base64,
					mediaType: part.file.mediaType,
					providerOptions: part.providerMetadata
				});
				break;
			case "reasoning-file":
				content.push({
					type: "reasoning-file",
					data: part.file.base64,
					mediaType: part.file.mediaType,
					providerOptions: part.providerMetadata
				});
				break;
			case "tool-call":
				if (!toolCallOrder.has(part.toolCallId)) toolCallOrder.set(part.toolCallId, toolCallOrder.size);
				content.push({
					type: "tool-call",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.invalid && typeof part.input !== "object" ? {} : part.input,
					providerExecuted: part.providerExecuted,
					providerOptions: part.providerMetadata
				});
				break;
			case "tool-result": {
				const output = await createToolModelOutput({
					toolCallId: part.toolCallId,
					input: part.input,
					tool: getOwn(tools, part.toolName),
					output: part.output,
					errorMode: "none"
				});
				content.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output,
					providerOptions: part.providerMetadata
				});
				break;
			}
			case "tool-error": {
				const output = await createToolModelOutput({
					toolCallId: part.toolCallId,
					input: part.input,
					tool: getOwn(tools, part.toolName),
					output: part.error,
					errorMode: "json"
				});
				content.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output,
					providerOptions: part.providerMetadata
				});
				break;
			}
			case "tool-approval-request":
				content.push({
					type: "tool-approval-request",
					approvalId: part.approvalId,
					toolCallId: part.toolCall.toolCallId,
					isAutomatic: part.isAutomatic,
					...part.signature != null ? { signature: part.signature } : {}
				});
				break;
		}
	}
	if (content.length > 0) responseMessages.push({
		role: "assistant",
		content
	});
	const toolResultContent = [];
	for (const part of inputContent) {
		if (part.type !== "tool-approval-response" && part.type !== "tool-result" && part.type !== "tool-error") continue;
		if (part.type === "tool-approval-response") {
			toolResultContent.push({
				type: "tool-approval-response",
				approvalId: part.approvalId,
				approved: part.approved,
				reason: part.reason,
				providerExecuted: part.providerExecuted
			});
			if (part.approved === false) toolResultContent.push({
				type: "tool-result",
				toolCallId: part.toolCall.toolCallId,
				toolName: part.toolCall.toolName,
				output: {
					type: "execution-denied",
					reason: part.reason
				}
			});
			continue;
		}
		if (part.providerExecuted) continue;
		const output = await createToolModelOutput({
			toolCallId: part.toolCallId,
			input: part.input,
			tool: getOwn(tools, part.toolName),
			output: part.type === "tool-result" ? part.output : part.error,
			errorMode: part.type === "tool-error" ? "text" : "none"
		});
		toolResultContent.push({
			type: "tool-result",
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			output,
			...part.providerMetadata != null ? { providerOptions: part.providerMetadata } : {}
		});
	}
	if (toolResultContent.length > 0) responseMessages.push({
		role: "tool",
		content: sortToolResultContentByToolCallOrder({
			toolResultContent,
			toolCallOrder
		})
	});
	return responseMessages;
}
function sortToolResultContentByToolCallOrder({ toolResultContent, toolCallOrder }) {
	const sortedToolResults = toolResultContent.filter((part) => part.type === "tool-result").map((part, index) => ({
		part,
		index
	})).sort((a, b) => {
		const aOrder = toolCallOrder.get(a.part.toolCallId);
		const bOrder = toolCallOrder.get(b.part.toolCallId);
		if (aOrder == null && bOrder == null) return a.index - b.index;
		if (aOrder == null) return 1;
		if (bOrder == null) return -1;
		return aOrder - bOrder || a.index - b.index;
	}).map(({ part }) => part);
	let toolResultIndex = 0;
	return toolResultContent.map((part) => part.type === "tool-result" ? sortedToolResults[toolResultIndex++] : part);
}
var encoder = new TextEncoder();
function canonicalJSON(value) {
	if (value === null || value === void 0) return JSON.stringify(value);
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
	return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
}
function toBase64url(bytes) {
	return convertUint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hashCanonical(value) {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJSON(value)));
	return toBase64url(new Uint8Array(digest));
}
var encoder2 = new TextEncoder();
function fromBase64url(str) {
	return convertBase64ToUint8Array(str);
}
async function importKey(secret) {
	const keyData = typeof secret === "string" ? encoder2.encode(secret) : secret;
	return crypto.subtle.importKey("raw", keyData, {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign", "verify"]);
}
function buildPayload(approvalId, toolCallId, toolName, inputDigest) {
	return encoder2.encode(`${approvalId}
${toolCallId}
${toolName}
${inputDigest}`);
}
async function signToolApproval({ secret, approvalId, toolCallId, toolName, input }) {
	const key = await importKey(secret);
	const payload = buildPayload(approvalId, toolCallId, toolName, await hashCanonical(input));
	const sig = await crypto.subtle.sign("HMAC", key, payload);
	return toBase64url(new Uint8Array(sig));
}
async function verifyToolApprovalSignature({ secret, signature, approvalId, toolCallId, toolName, input }) {
	const key = await importKey(secret);
	const payload = buildPayload(approvalId, toolCallId, toolName, await hashCanonical(input));
	const sigBytes = fromBase64url(signature);
	return crypto.subtle.verify("HMAC", key, sigBytes, payload);
}
async function maybeSignApproval({ secret, approvalId, toolCallId, toolName, input }) {
	if (secret == null) return void 0;
	return signToolApproval({
		secret,
		approvalId,
		toolCallId,
		toolName,
		input
	});
}
async function validateApprovedToolApprovals({ approvedToolApprovals, tools, toolApproval, messages, toolsContext, runtimeContext, toolApprovalSecret }) {
	var _a22;
	const approved = [];
	const denied = [];
	for (const approval of approvedToolApprovals) {
		const { toolCall, approvalRequest } = approval;
		const tool2 = getOwn(tools, toolCall.toolName);
		if (toolApprovalSecret != null) {
			if (approvalRequest.signature == null) throw new InvalidToolApprovalSignatureError({
				approvalId: approvalRequest.approvalId,
				toolCallId: toolCall.toolCallId,
				reason: "missing signature"
			});
			if (!await verifyToolApprovalSignature({
				secret: toolApprovalSecret,
				signature: approvalRequest.signature,
				approvalId: approvalRequest.approvalId,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
				input: toolCall.input
			})) throw new InvalidToolApprovalSignatureError({
				approvalId: approvalRequest.approvalId,
				toolCallId: toolCall.toolCallId,
				reason: "invalid signature"
			});
		}
		if (isExecutableTool(tool2) && tool2.inputSchema != null) {
			const validation = await safeValidateTypes({
				value: toolCall.input,
				schema: asSchema(tool2.inputSchema)
			});
			if (!validation.success) throw new InvalidToolInputError({
				toolName: toolCall.toolName,
				toolInput: JSON.stringify(toolCall.input),
				cause: validation.error
			});
		}
		const approvalStatus = await resolveToolApproval({
			tools,
			toolApproval,
			toolCall,
			messages,
			toolsContext,
			runtimeContext
		});
		if (approvalStatus.type === "denied") denied.push({
			...approval,
			approvalResponse: {
				...approval.approvalResponse,
				approved: false,
				reason: (_a22 = approvalStatus.reason) != null ? _a22 : approval.approvalResponse.reason
			}
		});
		else approved.push(approval);
	}
	return {
		approvedToolApprovals: approved,
		deniedToolApprovals: denied
	};
}
var originalGenerateId = createIdGenerator({
	prefix: "aitxt",
	size: 24
});
var originalGenerateCallId = createIdGenerator({
	prefix: "call",
	size: 24
});
async function generateText({ model: modelArg, tools, toolChoice, instructions, system, prompt, messages, allowSystemInMessages, maxRetries: maxRetriesArg, abortSignal, timeout, headers, stopWhen = isStepCount(1), experimental_sandbox: sandbox, output, toolApproval, experimental_toolApprovalSecret, experimental_telemetry, telemetry = experimental_telemetry, providerOptions, activeTools, toolOrder, prepareStep, experimental_repairToolCall, repairToolCall = experimental_repairToolCall, experimental_refineToolInput: refineToolInput, experimental_download: download2, runtimeContext = {}, toolsContext = {}, experimental_include, include = experimental_include, _internal: { generateId: generateId2 = originalGenerateId, generateCallId = originalGenerateCallId, now: now2 = now } = {}, onStart, experimental_onStart, onStepStart, experimental_onStepStart, onLanguageModelCallStart, experimental_onLanguageModelCallStart, onLanguageModelCallEnd, experimental_onLanguageModelCallEnd, onToolExecutionStart, onToolExecutionEnd, experimental_onToolCallStart, experimental_onToolCallFinish, onStepEnd, onStepFinish, onFinish, onEnd = onFinish, ...settings }) {
	var _a22, _b, _c, _d;
	include = {
		requestBody: (_a22 = include == null ? void 0 : include.requestBody) != null ? _a22 : false,
		requestMessages: (_b = include == null ? void 0 : include.requestMessages) != null ? _b : false,
		responseBody: (_c = include == null ? void 0 : include.responseBody) != null ? _c : false
	};
	const model = resolveLanguageModel(modelArg);
	const stopConditions = asArray(stopWhen);
	const resolvedOnStart = onStart != null ? onStart : experimental_onStart;
	const resolvedOnStepStart = onStepStart != null ? onStepStart : experimental_onStepStart;
	const resolvedOnLanguageModelCallStart = onLanguageModelCallStart != null ? onLanguageModelCallStart : experimental_onLanguageModelCallStart;
	const resolvedOnLanguageModelCallEnd = onLanguageModelCallEnd != null ? onLanguageModelCallEnd : experimental_onLanguageModelCallEnd;
	const resolvedOnToolExecutionStart = onToolExecutionStart != null ? onToolExecutionStart : experimental_onToolCallStart;
	const resolvedOnToolExecutionEnd = onToolExecutionEnd != null ? onToolExecutionEnd : experimental_onToolCallFinish;
	const resolvedOnStepEnd = onStepEnd != null ? onStepEnd : onStepFinish;
	const totalTimeoutMs = getTotalTimeoutMs(timeout);
	const stepTimeoutMs = getStepTimeoutMs(timeout);
	const stepAbortController = stepTimeoutMs != null ? new AbortController() : void 0;
	const mergedAbortSignal = mergeAbortSignals(abortSignal, totalTimeoutMs, stepAbortController == null ? void 0 : stepAbortController.signal);
	const { maxRetries, retry } = prepareRetries({
		maxRetries: maxRetriesArg,
		abortSignal: mergedAbortSignal
	});
	const callSettings = prepareLanguageModelCallOptions(settings);
	const headersWithUserAgent = withUserAgentSuffix(headers != null ? headers : {}, `ai/${VERSION}`);
	const initialPrompt = await standardizePrompt({
		instructions,
		system,
		prompt,
		messages,
		allowSystemInMessages
	});
	const callId = generateCallId();
	const telemetryDispatcher = createRestrictedTelemetryDispatcher({
		telemetry,
		includeRuntimeContext: telemetry == null ? void 0 : telemetry.includeRuntimeContext,
		includeToolsContext: telemetry == null ? void 0 : telemetry.includeToolsContext
	});
	const runInTracingChannelSpan = (_d = telemetryDispatcher.runInTracingChannelSpan) != null ? _d : async ({ execute }) => await execute();
	const generateTextStartEvent = {
		callId,
		operationId: "ai.generateText",
		provider: model.provider,
		modelId: model.modelId,
		instructions: initialPrompt.instructions,
		messages: initialPrompt.messages,
		tools,
		toolChoice,
		activeTools,
		toolOrder,
		maxOutputTokens: callSettings.maxOutputTokens,
		temperature: callSettings.temperature,
		topP: callSettings.topP,
		topK: callSettings.topK,
		presencePenalty: callSettings.presencePenalty,
		frequencyPenalty: callSettings.frequencyPenalty,
		stopSequences: callSettings.stopSequences,
		seed: callSettings.seed,
		reasoning: callSettings.reasoning,
		maxRetries,
		timeout,
		headers: headersWithUserAgent,
		providerOptions,
		output,
		runtimeContext,
		toolsContext
	};
	const executeGenerateText = async () => {
		var _a23;
		await notify({
			event: generateTextStartEvent,
			callbacks: [resolvedOnStart, telemetryDispatcher.onStart]
		});
		try {
			const initialMessages = initialPrompt.messages;
			const initialResponseMessages = [];
			const { approvedToolApprovals, deniedToolApprovals: collectedDeniedToolApprovals } = collectToolApprovals({ messages: initialMessages });
			const { approvedToolApprovals: localApprovedToolApprovals, deniedToolApprovals: revalidationDeniedToolApprovals } = await validateApprovedToolApprovals({
				approvedToolApprovals: approvedToolApprovals.filter((toolApproval2) => !toolApproval2.toolCall.providerExecuted),
				tools,
				toolApproval,
				messages: initialMessages,
				toolsContext,
				runtimeContext,
				toolApprovalSecret: experimental_toolApprovalSecret
			});
			const deniedToolApprovals = [...collectedDeniedToolApprovals, ...revalidationDeniedToolApprovals];
			if (deniedToolApprovals.length > 0 || localApprovedToolApprovals.length > 0) {
				const toolResults2 = await executeTools({
					toolCalls: localApprovedToolApprovals.map((toolApproval2) => toolApproval2.toolCall),
					tools,
					callId,
					messages: initialMessages,
					abortSignal: mergedAbortSignal,
					timeout,
					experimental_sandbox: sandbox,
					toolsContext,
					onToolExecutionStart: (event) => notify({
						event,
						callbacks: [resolvedOnToolExecutionStart, telemetryDispatcher.onToolExecutionStart]
					}),
					onToolExecutionEnd: (event) => notify({
						event,
						callbacks: [resolvedOnToolExecutionEnd, telemetryDispatcher.onToolExecutionEnd]
					}),
					executeToolInTelemetryContext: telemetryDispatcher.executeTool,
					runInTracingChannelSpan
				});
				const toolContent = [];
				for (const result of toolResults2) {
					const output2 = result.output;
					const modelOutput = await createToolModelOutput({
						toolCallId: output2.toolCallId,
						input: output2.input,
						tool: getOwn(tools, output2.toolName),
						output: output2.type === "tool-result" ? output2.output : output2.error,
						errorMode: output2.type === "tool-error" ? "text" : "none"
					});
					toolContent.push({
						type: "tool-result",
						toolCallId: output2.toolCallId,
						toolName: output2.toolName,
						output: modelOutput
					});
				}
				for (const toolApproval2 of deniedToolApprovals) toolContent.push({
					type: "tool-result",
					toolCallId: toolApproval2.toolCall.toolCallId,
					toolName: toolApproval2.toolCall.toolName,
					output: {
						type: "execution-denied",
						reason: toolApproval2.approvalResponse.reason,
						...toolApproval2.toolCall.providerExecuted && { providerOptions: { openai: { approvalId: toolApproval2.approvalResponse.approvalId } } }
					}
				});
				initialResponseMessages.push({
					role: "tool",
					content: toolContent
				});
			}
			const callSettings2 = prepareLanguageModelCallOptions(settings);
			let currentModelResponse;
			let clientToolCalls = [];
			let clientToolOutputs = [];
			let toolApprovalResponses = [];
			let deniedToolApprovalResponses = [];
			const steps = [];
			let instructionsForNextStep = initialPrompt.instructions;
			let messagesForNextStep = [...initialMessages, ...initialResponseMessages];
			const pendingDeferredToolCalls = /* @__PURE__ */ new Map();
			do {
				const stepTimeoutId = setAbortTimeout({
					abortController: stepAbortController,
					label: "Step",
					timeoutMs: stepTimeoutMs
				});
				const stepNumber = steps.length;
				try {
					await runInTracingChannelSpan({
						type: "step",
						event: {
							callId,
							stepNumber
						},
						execute: async () => {
							var _a24, _b2, _c2, _d2, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
							const accumulatedResponseMessages = [...initialResponseMessages, ...steps.flatMap((step) => step.response.messages)];
							const stepInputMessages = messagesForNextStep;
							const prepareStepResult = await (prepareStep == null ? void 0 : prepareStep({
								model,
								steps,
								stepNumber: steps.length,
								instructions: instructionsForNextStep,
								initialInstructions: initialPrompt.instructions,
								messages: stepInputMessages,
								initialMessages,
								responseMessages: accumulatedResponseMessages,
								runtimeContext,
								toolsContext,
								experimental_sandbox: sandbox
							}));
							const stepSandbox = (_a24 = prepareStepResult == null ? void 0 : prepareStepResult.experimental_sandbox) != null ? _a24 : sandbox;
							const stepModel = resolveLanguageModel((_b2 = prepareStepResult == null ? void 0 : prepareStepResult.model) != null ? _b2 : model);
							const stepInstructions = (_d2 = (_c2 = prepareStepResult == null ? void 0 : prepareStepResult.instructions) != null ? _c2 : prepareStepResult == null ? void 0 : prepareStepResult.system) != null ? _d2 : instructionsForNextStep;
							const promptMessages = await convertToLanguageModelPrompt({
								prompt: {
									instructions: stepInstructions,
									messages: (_e = prepareStepResult == null ? void 0 : prepareStepResult.messages) != null ? _e : stepInputMessages
								},
								supportedUrls: await stepModel.supportedUrls,
								download: download2,
								provider: stepModel.provider.split(".")[0]
							});
							runtimeContext = (_f = prepareStepResult == null ? void 0 : prepareStepResult.runtimeContext) != null ? _f : runtimeContext;
							toolsContext = (_g = prepareStepResult == null ? void 0 : prepareStepResult.toolsContext) != null ? _g : toolsContext;
							const stepActiveTools = filterActiveTools({
								tools,
								activeTools: (_h = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _h : activeTools
							});
							const stepToolOrder = (_i = prepareStepResult == null ? void 0 : prepareStepResult.toolOrder) != null ? _i : toolOrder;
							const stepTools = await prepareTools({
								tools: stepActiveTools,
								toolOrder: stepToolOrder,
								toolsContext,
								experimental_sandbox: stepSandbox
							});
							const stepToolChoice = prepareToolChoice({ toolChoice: (_j = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _j : toolChoice });
							const stepMessages = (_k = prepareStepResult == null ? void 0 : prepareStepResult.messages) != null ? _k : stepInputMessages;
							const stepProviderOptions = mergeObjects(providerOptions, prepareStepResult == null ? void 0 : prepareStepResult.providerOptions);
							await notify({
								event: {
									callId,
									provider: stepModel.provider,
									modelId: stepModel.modelId,
									stepNumber,
									instructions: stepInstructions,
									messages: stepMessages,
									tools,
									toolChoice: (_l = prepareStepResult == null ? void 0 : prepareStepResult.toolChoice) != null ? _l : toolChoice,
									activeTools: (_m = prepareStepResult == null ? void 0 : prepareStepResult.activeTools) != null ? _m : activeTools,
									toolOrder: stepToolOrder,
									steps: [...steps],
									providerOptions: stepProviderOptions,
									output,
									runtimeContext,
									promptMessages,
									stepTools,
									stepToolChoice,
									toolsContext
								},
								callbacks: [resolvedOnStepStart, telemetryDispatcher.onStepStart]
							});
							const languageModelCallStartEvent = {
								callId,
								provider: stepModel.provider,
								modelId: stepModel.modelId,
								instructions: stepInstructions,
								messages: stepMessages,
								tools: stepTools,
								...callSettings2
							};
							const stepStartTimestampMs = now2();
							await notify({
								event: languageModelCallStartEvent,
								callbacks: [resolvedOnLanguageModelCallStart, telemetryDispatcher.onLanguageModelCallStart]
							});
							const executeLanguageModelCallInTelemetryContext = (_n = telemetryDispatcher.executeLanguageModelCall) != null ? _n : async ({ execute }) => await execute();
							currentModelResponse = await retry(async () => {
								var _a25, _b3, _c3, _d3, _e2, _f2, _g2, _h2;
								const result = await executeLanguageModelCallInTelemetryContext({
									...languageModelCallStartEvent,
									execute: async () => await stepModel.doGenerate({
										...callSettings2,
										tools: stepTools,
										toolChoice: stepToolChoice,
										responseFormat: await (output == null ? void 0 : output.responseFormat),
										prompt: promptMessages,
										providerOptions: stepProviderOptions,
										abortSignal: mergedAbortSignal,
										headers: headersWithUserAgent
									})
								});
								const responseData = {
									id: (_b3 = (_a25 = result.response) == null ? void 0 : _a25.id) != null ? _b3 : generateId2(),
									timestamp: (_d3 = (_c3 = result.response) == null ? void 0 : _c3.timestamp) != null ? _d3 : /* @__PURE__ */ new Date(),
									modelId: (_f2 = (_e2 = result.response) == null ? void 0 : _e2.modelId) != null ? _f2 : stepModel.modelId,
									headers: (_g2 = result.response) == null ? void 0 : _g2.headers,
									body: (_h2 = result.response) == null ? void 0 : _h2.body
								};
								return {
									...result,
									response: responseData
								};
							});
							const responseTimeMs = now2() - stepStartTimestampMs;
							const stepUsage = asLanguageModelUsage(currentModelResponse.usage);
							const stepToolCalls = await Promise.all(currentModelResponse.content.filter((part) => part.type === "tool-call").map((toolCall) => parseToolCall({
								toolCall,
								tools,
								repairToolCall,
								refineToolInput,
								instructions: stepInstructions,
								messages: stepMessages
							})));
							const toolApprovalRequests = {};
							const stepToolApprovalResponses = {};
							const blockedToolCallIds = /* @__PURE__ */ new Set();
							const modelCallContent = asContent({
								content: currentModelResponse.content,
								toolCalls: stepToolCalls,
								toolOutputs: [],
								toolApprovalRequests: [],
								toolApprovalResponses: [],
								tools
							});
							await notify({
								event: {
									callId,
									provider: stepModel.provider,
									modelId: stepModel.modelId,
									finishReason: currentModelResponse.finishReason.unified,
									usage: stepUsage,
									content: modelCallContent,
									responseId: currentModelResponse.response.id,
									performance: {
										responseTimeMs,
										effectiveOutputTokensPerSecond: calculateTokensPerSecond({
											tokens: stepUsage.outputTokens,
											durationMs: responseTimeMs
										}),
										outputTokensPerSecond: void 0,
										inputTokensPerSecond: void 0,
										effectiveTotalTokensPerSecond: calculateTokensPerSecond({
											tokens: sumTokenCounts(stepUsage.inputTokens, stepUsage.outputTokens),
											durationMs: responseTimeMs
										}),
										timeToFirstOutputMs: void 0
									}
								},
								callbacks: [resolvedOnLanguageModelCallEnd, telemetryDispatcher.onLanguageModelCallEnd]
							});
							for (const toolCall of stepToolCalls) {
								if (toolCall.invalid) continue;
								const tool2 = getOwn(tools, toolCall.toolName);
								if (tool2 == null) continue;
								if ((tool2 == null ? void 0 : tool2.onInputAvailable) != null) await tool2.onInputAvailable({
									input: toolCall.input,
									toolCallId: toolCall.toolCallId,
									messages: stepMessages,
									abortSignal: mergedAbortSignal,
									context: runtimeContext
								});
								const toolApprovalStatus = await resolveToolApproval({
									tools,
									toolApproval,
									toolCall,
									messages: stepMessages,
									toolsContext,
									runtimeContext
								});
								if (toolApprovalStatus.type === "not-applicable") continue;
								const approvalId = generateId2();
								const signature = await maybeSignApproval({
									secret: experimental_toolApprovalSecret,
									approvalId,
									toolCallId: toolCall.toolCallId,
									toolName: toolCall.toolName,
									input: toolCall.input
								});
								switch (toolApprovalStatus.type) {
									case "user-approval":
										toolApprovalRequests[toolCall.toolCallId] = {
											type: "tool-approval-request",
											approvalId,
											toolCall,
											...signature != null ? { signature } : {}
										};
										blockedToolCallIds.add(toolCall.toolCallId);
										break;
									case "approved":
										toolApprovalRequests[toolCall.toolCallId] = {
											type: "tool-approval-request",
											approvalId,
											toolCall,
											isAutomatic: true,
											...signature != null ? { signature } : {}
										};
										stepToolApprovalResponses[toolCall.toolCallId] = {
											type: "tool-approval-response",
											approvalId,
											toolCall,
											approved: true,
											reason: toolApprovalStatus.reason,
											providerExecuted: toolCall.providerExecuted
										};
										break;
									case "denied":
										toolApprovalRequests[toolCall.toolCallId] = {
											type: "tool-approval-request",
											approvalId,
											toolCall,
											isAutomatic: true,
											...signature != null ? { signature } : {}
										};
										stepToolApprovalResponses[toolCall.toolCallId] = {
											type: "tool-approval-response",
											approvalId,
											toolCall,
											approved: false,
											reason: toolApprovalStatus.reason,
											providerExecuted: toolCall.providerExecuted
										};
										blockedToolCallIds.add(toolCall.toolCallId);
										break;
								}
							}
							const invalidToolCalls = stepToolCalls.filter((toolCall) => toolCall.invalid && toolCall.dynamic);
							clientToolOutputs = [];
							for (const toolCall of invalidToolCalls) clientToolOutputs.push({
								type: "tool-error",
								toolCallId: toolCall.toolCallId,
								toolName: toolCall.toolName,
								input: toolCall.input,
								error: getErrorMessage(toolCall.error),
								dynamic: true
							});
							clientToolCalls = stepToolCalls.filter((toolCall) => !toolCall.providerExecuted);
							toolApprovalResponses = Object.values(stepToolApprovalResponses);
							deniedToolApprovalResponses = toolApprovalResponses.filter((toolApprovalResponse) => toolApprovalResponse.approved === false);
							const toolExecutionMs = {};
							if (tools != null) {
								const toolExecutionResults = await executeTools({
									toolCalls: clientToolCalls.filter((toolCall) => !toolCall.invalid && !blockedToolCallIds.has(toolCall.toolCallId)),
									tools,
									callId,
									messages: stepMessages,
									abortSignal: mergedAbortSignal,
									timeout,
									experimental_sandbox: stepSandbox,
									toolsContext,
									onToolExecutionStart: (event) => notify({
										event,
										callbacks: [resolvedOnToolExecutionStart, telemetryDispatcher.onToolExecutionStart]
									}),
									onToolExecutionEnd: (event) => notify({
										event,
										callbacks: [resolvedOnToolExecutionEnd, telemetryDispatcher.onToolExecutionEnd]
									}),
									executeToolInTelemetryContext: telemetryDispatcher.executeTool,
									runInTracingChannelSpan
								});
								for (const result of toolExecutionResults) {
									toolExecutionMs[result.output.toolCallId] = result.toolExecutionMs;
									clientToolOutputs.push(result.output);
								}
							}
							const stepTimeMs = now2() - stepStartTimestampMs;
							const stepPerformance = {
								effectiveOutputTokensPerSecond: calculateTokensPerSecond({
									tokens: stepUsage.outputTokens,
									durationMs: responseTimeMs
								}),
								outputTokensPerSecond: void 0,
								inputTokensPerSecond: void 0,
								effectiveTotalTokensPerSecond: calculateTokensPerSecond({
									tokens: sumTokenCounts(stepUsage.inputTokens, stepUsage.outputTokens),
									durationMs: responseTimeMs
								}),
								stepTimeMs,
								responseTimeMs,
								toolExecutionMs,
								timeToFirstOutputMs: void 0
							};
							for (const toolCall of stepToolCalls) {
								if (!toolCall.providerExecuted) continue;
								const tool2 = getOwn(tools, toolCall.toolName);
								if ((tool2 == null ? void 0 : tool2.type) === "provider" && tool2.supportsDeferredResults) {
									if (!currentModelResponse.content.some((part) => part.type === "tool-result" && part.toolCallId === toolCall.toolCallId)) pendingDeferredToolCalls.set(toolCall.toolCallId, { toolName: toolCall.toolName });
								}
							}
							for (const part of currentModelResponse.content) if (part.type === "tool-result") pendingDeferredToolCalls.delete(part.toolCallId);
							const stepContent = asContent({
								content: currentModelResponse.content,
								toolCalls: stepToolCalls,
								toolOutputs: clientToolOutputs,
								toolApprovalRequests: Object.values(toolApprovalRequests),
								toolApprovalResponses,
								tools
							});
							const stepResponseMessages = await toResponseMessages({
								content: stepContent,
								tools
							});
							const stepRequest = {
								...currentModelResponse.request,
								body: include.requestBody ? (_o = currentModelResponse.request) == null ? void 0 : _o.body : void 0,
								messages: include.requestMessages ? cloneModelMessages(stepMessages) : void 0
							};
							const stepResponse = {
								...currentModelResponse.response,
								messages: cloneModelMessages(stepResponseMessages),
								body: include.responseBody ? (_p = currentModelResponse.response) == null ? void 0 : _p.body : void 0
							};
							const currentStepResult = new DefaultStepResult({
								callId,
								stepNumber,
								provider: stepModel.provider,
								modelId: stepModel.modelId,
								runtimeContext,
								content: stepContent,
								finishReason: currentModelResponse.finishReason.unified,
								rawFinishReason: currentModelResponse.finishReason.raw,
								usage: stepUsage,
								performance: stepPerformance,
								warnings: currentModelResponse.warnings,
								providerMetadata: currentModelResponse.providerMetadata,
								request: stepRequest,
								response: stepResponse,
								toolsContext
							});
							logWarnings({
								warnings: (_q = currentModelResponse.warnings) != null ? _q : [],
								provider: stepModel.provider,
								model: stepModel.modelId
							});
							steps.push(currentStepResult);
							instructionsForNextStep = stepInstructions;
							messagesForNextStep = [...stepMessages, ...stepResponseMessages];
							await notify({
								event: currentStepResult,
								callbacks: [resolvedOnStepEnd, telemetryDispatcher.onStepEnd]
							});
							return currentStepResult;
						}
					});
				} finally {
					if (stepTimeoutId != null) clearTimeout(stepTimeoutId);
				}
			} while ((clientToolCalls.length > 0 && clientToolOutputs.length + deniedToolApprovalResponses.length === clientToolCalls.length || pendingDeferredToolCalls.size > 0) && !await isStopConditionMet({
				stopConditions,
				steps
			}));
			const lastStep = steps[steps.length - 1];
			const totalUsage = steps.reduce((totalUsage2, step) => {
				return addLanguageModelUsage(totalUsage2, step.usage);
			}, {
				inputTokens: void 0,
				inputTokenDetails: {
					noCacheTokens: void 0,
					cacheReadTokens: void 0,
					cacheWriteTokens: void 0
				},
				outputTokens: void 0,
				outputTokenDetails: {
					textTokens: void 0,
					reasoningTokens: void 0
				},
				totalTokens: void 0
			});
			const files = steps.flatMap((step) => step.files);
			const sources = steps.flatMap((step) => step.sources);
			const toolCalls = steps.flatMap((step) => step.toolCalls);
			const staticToolCalls = steps.flatMap((step) => step.staticToolCalls);
			const dynamicToolCalls = steps.flatMap((step) => step.dynamicToolCalls);
			const toolResults = steps.flatMap((step) => step.toolResults);
			const staticToolResults = steps.flatMap((step) => step.staticToolResults);
			const dynamicToolResults = steps.flatMap((step) => step.dynamicToolResults);
			const warnings = steps.flatMap((step) => {
				var _a24;
				return (_a24 = step.warnings) != null ? _a24 : [];
			});
			await notify({
				event: {
					callId,
					stepNumber: lastStep.stepNumber,
					model: lastStep.model,
					runtimeContext: lastStep.runtimeContext,
					finishReason: lastStep.finishReason,
					rawFinishReason: lastStep.rawFinishReason,
					usage: totalUsage,
					totalUsage,
					content: steps.flatMap((step) => step.content),
					text: lastStep.text,
					reasoning: lastStep.reasoning,
					reasoningText: lastStep.reasoningText,
					files,
					sources,
					toolCalls,
					staticToolCalls,
					dynamicToolCalls,
					toolResults,
					staticToolResults,
					dynamicToolResults,
					responseMessages: [...initialResponseMessages, ...steps.flatMap((step) => step.response.messages)],
					warnings,
					request: lastStep.request,
					response: lastStep.response,
					providerMetadata: lastStep.providerMetadata,
					steps,
					finalStep: lastStep,
					toolsContext
				},
				callbacks: [onEnd, telemetryDispatcher.onEnd]
			});
			let resolvedOutput;
			if (lastStep.finishReason === "stop") resolvedOutput = await (output != null ? output : text()).parseCompleteOutput({ text: lastStep.text }, {
				response: lastStep.response,
				usage: lastStep.usage,
				finishReason: lastStep.finishReason
			});
			return new DefaultGenerateTextResult({
				initialResponseMessages,
				steps,
				totalUsage,
				output: resolvedOutput
			});
		} catch (error) {
			await ((_a23 = telemetryDispatcher.onError) == null ? void 0 : _a23.call(telemetryDispatcher, {
				callId,
				error
			}));
			throw wrapGatewayError(error);
		}
	};
	return await runInTracingChannelSpan({
		type: "generateText",
		event: generateTextStartEvent,
		execute: executeGenerateText
	});
}
async function executeTools({ toolCalls, tools, callId, messages, abortSignal, timeout, experimental_sandbox: sandbox, toolsContext, onToolExecutionStart, onToolExecutionEnd, executeToolInTelemetryContext, runInTracingChannelSpan }) {
	return (await Promise.all(toolCalls.map(async (toolCall) => await executeToolCall({
		toolCall,
		tools,
		callId,
		messages,
		abortSignal,
		timeout,
		experimental_sandbox: sandbox,
		toolsContext,
		onToolExecutionStart,
		onToolExecutionEnd,
		executeToolInTelemetryContext,
		runInTracingChannelSpan
	})))).filter((result) => result != null);
}
var DefaultGenerateTextResult = class {
	constructor(options) {
		this.initialResponseMessages = options.initialResponseMessages;
		this.steps = options.steps;
		this._output = options.output;
		this.totalUsage = options.totalUsage;
	}
	get finalStep() {
		return this.steps.at(-1);
	}
	get content() {
		return this.steps.flatMap((step) => step.content);
	}
	get text() {
		return this.finalStep.text;
	}
	get files() {
		return this.steps.flatMap((step) => step.files);
	}
	get reasoningText() {
		return this.finalStep.reasoningText;
	}
	get reasoning() {
		return convertToReasoningOutputs(this.finalStep.reasoning);
	}
	get toolCalls() {
		return this.steps.flatMap((step) => step.toolCalls);
	}
	get staticToolCalls() {
		return this.steps.flatMap((step) => step.staticToolCalls);
	}
	get dynamicToolCalls() {
		return this.steps.flatMap((step) => step.dynamicToolCalls);
	}
	get toolResults() {
		return this.steps.flatMap((step) => step.toolResults);
	}
	get staticToolResults() {
		return this.steps.flatMap((step) => step.staticToolResults);
	}
	get dynamicToolResults() {
		return this.steps.flatMap((step) => step.dynamicToolResults);
	}
	get sources() {
		return this.steps.flatMap((step) => step.sources);
	}
	get finishReason() {
		return this.finalStep.finishReason;
	}
	get rawFinishReason() {
		return this.finalStep.rawFinishReason;
	}
	get warnings() {
		return this.steps.flatMap((step) => {
			var _a22;
			return (_a22 = step.warnings) != null ? _a22 : [];
		});
	}
	get providerMetadata() {
		return this.finalStep.providerMetadata;
	}
	get response() {
		return this.finalStep.response;
	}
	get responseMessages() {
		return [...this.initialResponseMessages, ...this.steps.flatMap((step) => step.response.messages)];
	}
	get request() {
		return this.finalStep.request;
	}
	get usage() {
		return this.totalUsage;
	}
	get output() {
		if (this._output == null) throw new NoOutputGeneratedError();
		return this._output;
	}
};
function asContent({ content, toolCalls, toolOutputs, toolApprovalRequests, toolApprovalResponses, tools }) {
	const contentParts = [];
	const toolOutputsWithApprovalResponses = [];
	const toolOutputsWithoutApprovalResponses = [];
	const toolCallIdsWithApprovalResponses = new Set(toolApprovalResponses.map((toolApprovalResponse) => toolApprovalResponse.toolCall.toolCallId));
	for (const part of content) switch (part.type) {
		case "text":
		case "reasoning":
		case "custom":
		case "source":
			contentParts.push(part);
			break;
		case "file":
		case "reasoning-file":
			contentParts.push({
				type: part.type,
				file: new DefaultGeneratedFile({
					data: part.data.type === "data" ? part.data.data : part.data.url.toString(),
					mediaType: part.mediaType
				}),
				...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {}
			});
			break;
		case "tool-call":
			contentParts.push(toolCalls.find((toolCall) => toolCall.toolCallId === part.toolCallId));
			break;
		case "tool-result": {
			const toolCall = toolCalls.find((toolCall2) => toolCall2.toolCallId === part.toolCallId);
			if (toolCall == null) {
				const tool2 = getOwn(tools, part.toolName);
				if (!((tool2 == null ? void 0 : tool2.type) === "provider" && tool2.supportsDeferredResults)) throw new Error(`Tool call ${part.toolCallId} not found.`);
				if (part.isError) contentParts.push({
					type: "tool-error",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: void 0,
					error: part.result,
					providerExecuted: true,
					dynamic: part.dynamic,
					...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
					...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
				});
				else contentParts.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: void 0,
					output: part.result,
					providerExecuted: true,
					dynamic: part.dynamic,
					...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
					...(tool2 == null ? void 0 : tool2.metadata) != null ? { toolMetadata: tool2.metadata } : {}
				});
				break;
			}
			if (part.isError) contentParts.push({
				type: "tool-error",
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				input: toolCall.input,
				error: part.result,
				providerExecuted: true,
				dynamic: toolCall.dynamic,
				...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
				...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
			});
			else contentParts.push({
				type: "tool-result",
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				input: toolCall.input,
				output: part.result,
				providerExecuted: true,
				dynamic: toolCall.dynamic,
				...part.providerMetadata != null ? { providerMetadata: part.providerMetadata } : {},
				...toolCall.toolMetadata != null ? { toolMetadata: toolCall.toolMetadata } : {}
			});
			break;
		}
		case "tool-approval-request": {
			const toolCall = toolCalls.find((toolCall2) => toolCall2.toolCallId === part.toolCallId);
			if (toolCall == null) throw new ToolCallNotFoundForApprovalError({
				toolCallId: part.toolCallId,
				approvalId: part.approvalId
			});
			contentParts.push({
				type: "tool-approval-request",
				approvalId: part.approvalId,
				toolCall
			});
			break;
		}
	}
	for (const toolOutput of toolOutputs) if (toolCallIdsWithApprovalResponses.has(toolOutput.toolCallId)) toolOutputsWithApprovalResponses.push(toolOutput);
	else toolOutputsWithoutApprovalResponses.push(toolOutput);
	return [
		...contentParts,
		...toolOutputsWithoutApprovalResponses,
		...toolApprovalRequests,
		...toolApprovalResponses,
		...toolOutputsWithApprovalResponses
	];
}
TransformStream;
var toolMetadataSchema = record(string(), jsonValueSchema.optional());
lazySchema(() => zodSchema(union([
	strictObject({
		type: literal("text-start"),
		id: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("text-delta"),
		id: string(),
		delta: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("text-end"),
		id: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("error"),
		errorText: string()
	}),
	strictObject({
		type: literal("tool-input-start"),
		toolCallId: string(),
		toolName: string(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional(),
		toolMetadata: toolMetadataSchema.optional(),
		dynamic: boolean().optional(),
		title: string().optional()
	}),
	strictObject({
		type: literal("tool-input-delta"),
		toolCallId: string(),
		inputTextDelta: string()
	}),
	strictObject({
		type: literal("tool-input-available"),
		toolCallId: string(),
		toolName: string(),
		input: unknown(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional(),
		toolMetadata: toolMetadataSchema.optional(),
		dynamic: boolean().optional(),
		title: string().optional()
	}),
	strictObject({
		type: literal("tool-input-error"),
		toolCallId: string(),
		toolName: string(),
		input: unknown(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional(),
		toolMetadata: toolMetadataSchema.optional(),
		dynamic: boolean().optional(),
		errorText: string(),
		title: string().optional()
	}),
	strictObject({
		type: literal("tool-approval-request"),
		approvalId: string(),
		toolCallId: string(),
		isAutomatic: boolean().optional(),
		signature: string().optional()
	}),
	strictObject({
		type: literal("tool-approval-response"),
		approvalId: string(),
		approved: boolean(),
		reason: string().optional(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("tool-output-available"),
		toolCallId: string(),
		output: unknown(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional(),
		toolMetadata: toolMetadataSchema.optional(),
		dynamic: boolean().optional(),
		preliminary: boolean().optional()
	}),
	strictObject({
		type: literal("tool-output-error"),
		toolCallId: string(),
		errorText: string(),
		providerExecuted: boolean().optional(),
		providerMetadata: providerMetadataSchema.optional(),
		toolMetadata: toolMetadataSchema.optional(),
		dynamic: boolean().optional()
	}),
	strictObject({
		type: literal("tool-output-denied"),
		toolCallId: string()
	}),
	strictObject({
		type: literal("reasoning-start"),
		id: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("reasoning-delta"),
		id: string(),
		delta: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("reasoning-end"),
		id: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("custom"),
		kind: string().transform((value) => value),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("source-url"),
		sourceId: string(),
		url: string(),
		title: string().optional(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("source-document"),
		sourceId: string(),
		mediaType: string(),
		title: string(),
		filename: string().optional(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("file"),
		url: string(),
		mediaType: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: literal("reasoning-file"),
		url: string(),
		mediaType: string(),
		providerMetadata: providerMetadataSchema.optional()
	}),
	strictObject({
		type: custom((value) => typeof value === "string" && value.startsWith("data-"), { message: "Type must start with \"data-\"" }),
		id: string().optional(),
		data: unknown(),
		transient: boolean().optional()
	}),
	strictObject({ type: literal("start-step") }),
	strictObject({ type: literal("finish-step") }),
	strictObject({
		type: literal("start"),
		messageId: string().optional(),
		messageMetadata: unknown().optional()
	}),
	strictObject({
		type: literal("finish"),
		finishReason: _enum([
			"stop",
			"length",
			"content-filter",
			"tool-calls",
			"error",
			"other"
		]).optional(),
		messageMetadata: unknown().optional()
	}),
	strictObject({
		type: literal("abort"),
		reason: string().optional()
	}),
	strictObject({
		type: literal("message-metadata"),
		messageMetadata: unknown()
	})
])));
createIdGenerator({
	prefix: "aitxt",
	size: 24
});
createIdGenerator({
	prefix: "call",
	size: 24
});
createIdGenerator({
	prefix: "aitxt",
	size: 24
});
createIdGenerator({
	prefix: "call",
	size: 24
});
var toolMetadataSchema2 = record(string(), jsonValueSchema.optional());
var providerReferenceSchema2 = record(string(), string());
lazySchema(() => zodSchema(array$1(object$1({
	id: string(),
	role: _enum([
		"system",
		"user",
		"assistant"
	]),
	metadata: unknown().optional(),
	parts: array$1(union([
		object$1({
			type: literal("text"),
			text: string(),
			state: _enum(["streaming", "done"]).optional(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("reasoning"),
			text: string(),
			state: _enum(["streaming", "done"]).optional(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("custom"),
			kind: string(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("source-url"),
			sourceId: string(),
			url: string(),
			title: string().optional(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("source-document"),
			sourceId: string(),
			mediaType: string(),
			title: string(),
			filename: string().optional(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("file"),
			mediaType: string(),
			filename: string().optional(),
			url: string(),
			providerReference: providerReferenceSchema2.optional(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({
			type: literal("reasoning-file"),
			mediaType: string(),
			url: string(),
			providerMetadata: providerMetadataSchema.optional()
		}),
		object$1({ type: literal("step-start") }),
		object$1({
			type: string().startsWith("data-"),
			id: string().optional(),
			data: unknown()
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("input-streaming"),
			input: unknown().optional(),
			providerExecuted: boolean().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			output: never().optional(),
			errorText: never().optional(),
			approval: never().optional()
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("input-available"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: never().optional()
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("approval-requested"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: never().optional(),
				reason: never().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("approval-responded"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: boolean(),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-available"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: unknown(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			resultProviderMetadata: providerMetadataSchema.optional(),
			preliminary: boolean().optional(),
			approval: object$1({
				id: string(),
				approved: literal(true),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			}).optional()
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-error"),
			input: unknown().optional(),
			rawInput: unknown().optional(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: string(),
			callProviderMetadata: providerMetadataSchema.optional(),
			resultProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: literal(true),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			}).optional()
		}),
		object$1({
			type: literal("dynamic-tool"),
			toolName: string(),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-denied"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: literal(false),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("input-streaming"),
			providerExecuted: boolean().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			input: unknown().optional(),
			output: never().optional(),
			errorText: never().optional(),
			approval: never().optional()
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("input-available"),
			providerExecuted: boolean().optional(),
			input: unknown(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: never().optional()
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("approval-requested"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: never().optional(),
				reason: never().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("approval-responded"),
			input: unknown(),
			providerExecuted: boolean().optional(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: boolean(),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-available"),
			providerExecuted: boolean().optional(),
			input: unknown(),
			output: unknown(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			resultProviderMetadata: providerMetadataSchema.optional(),
			preliminary: boolean().optional(),
			approval: object$1({
				id: string(),
				approved: literal(true),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			}).optional()
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-error"),
			providerExecuted: boolean().optional(),
			input: unknown().optional(),
			rawInput: unknown().optional(),
			output: never().optional(),
			errorText: string(),
			callProviderMetadata: providerMetadataSchema.optional(),
			resultProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: literal(true),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			}).optional()
		}),
		object$1({
			type: string().startsWith("tool-"),
			toolCallId: string(),
			toolMetadata: toolMetadataSchema2.optional(),
			state: literal("output-denied"),
			providerExecuted: boolean().optional(),
			input: unknown(),
			output: never().optional(),
			errorText: never().optional(),
			callProviderMetadata: providerMetadataSchema.optional(),
			approval: object$1({
				id: string(),
				approved: literal(false),
				reason: string().optional(),
				isAutomatic: boolean().optional(),
				signature: string().optional()
			})
		})
	])).nonempty("Message must contain at least one part")
})).nonempty("Messages array must not be empty")));
createIdGenerator({
	prefix: "call",
	size: 24
});
createIdGenerator({
	prefix: "call",
	size: 24
});
createIdGenerator({
	prefix: "aiobj",
	size: 24
});
function createDownload(options) {
	return ({ url, abortSignal }) => download({
		url,
		maxBytes: options == null ? void 0 : options.maxBytes,
		abortSignal
	});
}
createIdGenerator({
	prefix: "aiobj",
	size: 24
});
createIdGenerator({
	prefix: "call",
	size: 24
});
//#endregion
export { dist_exports as t };
