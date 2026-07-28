import { A as isCustomReasoning, E as generateId, G as serializeModelOptions, Gt as UnsupportedFunctionalityError, Ht as InvalidPromptError, I as parseProviderOptions, J as withoutTrailingSlash, L as postFormDataToApi, O as getTopLevelMediaType, R as postJsonToApi, S as downloadBlob, St as record, Tt as union, Ut as TooManyEmbeddingValuesForCallError, V as resolveFullMediaType, X as WORKFLOW_DESERIALIZE, Z as WORKFLOW_SERIALIZE, _ as createEventSourceResponseHandler, at as _enum, b as createJsonResponseHandler, c as StreamingToolCallTracker, ct as any, f as combineHeaders, gt as looseObject, h as convertToFormData, ht as literal, lt as array, m as convertToBase64, p as convertBase64ToUint8Array, q as withUserAgentSuffix, ut as boolean, vt as number, wt as string, y as createJsonErrorResponseHandler, yt as object } from "./@ai-sdk/gateway+[...].mjs";
//#region node_modules/@ai-sdk/openai-compatible/dist/index.js
function toCamelCase(str) {
	return str.replace(/[_-]([a-z])/g, (g) => g[1].toUpperCase());
}
function resolveProviderOptionsKey(rawName, providerOptions) {
	const camelName = toCamelCase(rawName);
	if (camelName !== rawName && (providerOptions == null ? void 0 : providerOptions[camelName]) != null) return camelName;
	return rawName;
}
function warnIfDeprecatedProviderOptionsKey({ rawName, providerOptions, warnings }) {
	const camelName = toCamelCase(rawName);
	if (camelName !== rawName && (providerOptions == null ? void 0 : providerOptions[rawName]) != null) warnings.push({
		type: "deprecated",
		setting: `providerOptions key '${rawName}'`,
		message: `Use '${camelName}' instead.`
	});
}
var defaultOpenAICompatibleErrorStructure = {
	errorSchema: object({ error: object({
		message: string(),
		type: string().nullish(),
		param: any().nullish(),
		code: union([string(), number()]).nullish()
	}) }),
	errorToMessage: (data) => data.error.message
};
function convertOpenAICompatibleChatUsage(usage) {
	var _a, _b, _c, _d, _e, _f;
	if (usage == null) return {
		inputTokens: {
			total: void 0,
			noCache: void 0,
			cacheRead: void 0,
			cacheWrite: void 0
		},
		outputTokens: {
			total: void 0,
			text: void 0,
			reasoning: void 0
		},
		raw: void 0
	};
	const promptTokens = (_a = usage.prompt_tokens) != null ? _a : 0;
	const completionTokens = (_b = usage.completion_tokens) != null ? _b : 0;
	const cacheReadTokens = (_d = (_c = usage.prompt_tokens_details) == null ? void 0 : _c.cached_tokens) != null ? _d : 0;
	const reasoningTokens = (_f = (_e = usage.completion_tokens_details) == null ? void 0 : _e.reasoning_tokens) != null ? _f : 0;
	return {
		inputTokens: {
			total: promptTokens,
			noCache: promptTokens - cacheReadTokens,
			cacheRead: cacheReadTokens,
			cacheWrite: void 0
		},
		outputTokens: {
			total: completionTokens,
			text: completionTokens - reasoningTokens,
			reasoning: reasoningTokens
		},
		raw: usage
	};
}
function getOpenAIMetadata(message) {
	var _a, _b;
	return (_b = (_a = message == null ? void 0 : message.providerOptions) == null ? void 0 : _a.openaiCompatible) != null ? _b : {};
}
function getAudioFormat(mediaType) {
	switch (mediaType) {
		case "audio/wav": return "wav";
		case "audio/mp3":
		case "audio/mpeg": return "mp3";
		default: return null;
	}
}
function convertToOpenAICompatibleChatMessages(prompt) {
	var _a, _b, _c;
	const messages = [];
	for (const { role, content, ...message } of prompt) {
		const metadata = getOpenAIMetadata({ ...message });
		switch (role) {
			case "system":
				messages.push({
					role: "system",
					content,
					...metadata
				});
				break;
			case "user":
				if (content.length === 1 && content[0].type === "text") {
					messages.push({
						role: "user",
						content: content[0].text,
						...getOpenAIMetadata(content[0])
					});
					break;
				}
				messages.push({
					role: "user",
					content: content.map((part) => {
						var _a2;
						const partMetadata = getOpenAIMetadata(part);
						switch (part.type) {
							case "text": return {
								type: "text",
								text: part.text,
								...partMetadata
							};
							case "file": switch (part.data.type) {
								case "reference": throw new UnsupportedFunctionalityError({ functionality: "file parts with provider references" });
								case "text": throw new UnsupportedFunctionalityError({ functionality: "text file parts" });
								case "url":
								case "data": {
									const topLevel = getTopLevelMediaType(part.mediaType);
									if (topLevel === "image") return {
										type: "image_url",
										image_url: { url: part.data.type === "url" ? part.data.url.toString() : `data:${resolveFullMediaType({ part })};base64,${convertToBase64(part.data.data)}` },
										...partMetadata
									};
									if (topLevel === "audio") {
										if (part.data.type === "url") throw new UnsupportedFunctionalityError({ functionality: "audio file parts with URLs" });
										const fullMediaType = resolveFullMediaType({ part });
										const format = getAudioFormat(fullMediaType);
										if (format === null) throw new UnsupportedFunctionalityError({ functionality: `audio media type ${fullMediaType}` });
										return {
											type: "input_audio",
											input_audio: {
												data: convertToBase64(part.data.data),
												format
											},
											...partMetadata
										};
									}
									if (topLevel === "application") {
										if (part.data.type === "url") throw new UnsupportedFunctionalityError({ functionality: "PDF file parts with URLs" });
										const fullMediaType = resolveFullMediaType({ part });
										if (fullMediaType !== "application/pdf") throw new UnsupportedFunctionalityError({ functionality: `file part media type ${fullMediaType}` });
										return {
											type: "file",
											file: {
												filename: (_a2 = part.filename) != null ? _a2 : "document.pdf",
												file_data: `data:application/pdf;base64,${convertToBase64(part.data.data)}`
											},
											...partMetadata
										};
									}
									if (topLevel === "text") return {
										type: "text",
										text: part.data.type === "url" ? part.data.url.toString() : typeof part.data.data === "string" ? new TextDecoder().decode(convertBase64ToUint8Array(part.data.data)) : new TextDecoder().decode(part.data.data),
										...partMetadata
									};
									throw new UnsupportedFunctionalityError({ functionality: `file part media type ${part.mediaType}` });
								}
							}
						}
					}),
					...metadata
				});
				break;
			case "assistant": {
				let text = "";
				let reasoning = "";
				const toolCalls = [];
				for (const part of content) {
					const partMetadata = getOpenAIMetadata(part);
					switch (part.type) {
						case "text":
							text += part.text;
							break;
						case "reasoning":
							reasoning += part.text;
							break;
						case "tool-call": {
							const thoughtSignature = (_b = (_a = part.providerOptions) == null ? void 0 : _a.google) == null ? void 0 : _b.thoughtSignature;
							toolCalls.push({
								id: part.toolCallId,
								type: "function",
								function: {
									name: part.toolName,
									arguments: JSON.stringify(part.input)
								},
								...partMetadata,
								...thoughtSignature ? { extra_content: { google: { thought_signature: String(thoughtSignature) } } } : {}
							});
							break;
						}
					}
				}
				messages.push({
					role: "assistant",
					content: toolCalls.length > 0 ? text || null : text,
					...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
					tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
					...metadata
				});
				break;
			}
			case "tool":
				for (const toolResponse of content) {
					if (toolResponse.type === "tool-approval-response") continue;
					const output = toolResponse.output;
					let contentValue;
					switch (output.type) {
						case "text":
						case "error-text":
							contentValue = output.value;
							break;
						case "execution-denied":
							contentValue = (_c = output.reason) != null ? _c : "Tool call execution denied.";
							break;
						case "content":
						case "json":
						case "error-json":
							contentValue = JSON.stringify(output.value);
							break;
					}
					const toolResponseMetadata = getOpenAIMetadata(toolResponse);
					messages.push({
						role: "tool",
						tool_call_id: toolResponse.toolCallId,
						content: contentValue,
						...toolResponseMetadata
					});
				}
				break;
			default: throw new Error(`Unsupported role: ${role}`);
		}
	}
	return messages;
}
function getResponseMetadata({ id, model, created }) {
	return {
		id: id != null ? id : void 0,
		modelId: model != null ? model : void 0,
		timestamp: created != null ? /* @__PURE__ */ new Date(created * 1e3) : void 0
	};
}
function mapOpenAICompatibleFinishReason(finishReason) {
	switch (finishReason) {
		case "stop": return "stop";
		case "length": return "length";
		case "content_filter": return "content-filter";
		case "function_call":
		case "tool_calls": return "tool-calls";
		default: return "other";
	}
}
var openaiCompatibleLanguageModelChatOptions = object({
	/**
	* A unique identifier representing your end-user, which can help the provider to
	* monitor and detect abuse.
	*/
	user: string().optional(),
	/**
	* Reasoning effort for reasoning models. Defaults to `medium`.
	*/
	reasoningEffort: string().optional(),
	/**
	* Controls the verbosity of the generated text. Defaults to `medium`.
	*/
	textVerbosity: string().optional(),
	/**
	* Whether to use strict JSON schema validation.
	* When true, the model uses constrained decoding to guarantee schema compliance.
	* Only used when the provider supports structured outputs and a schema is provided.
	*
	* @default true
	*/
	strictJsonSchema: boolean().optional()
});
function prepareTools({ tools, toolChoice }) {
	tools = (tools == null ? void 0 : tools.length) ? tools : void 0;
	const toolWarnings = [];
	if (tools == null) return {
		tools: void 0,
		toolChoice: void 0,
		toolWarnings
	};
	const openaiCompatTools = [];
	for (const tool of tools) if (tool.type === "provider") toolWarnings.push({
		type: "unsupported",
		feature: `provider-defined tool ${tool.id}`
	});
	else openaiCompatTools.push({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
			...tool.strict != null ? { strict: tool.strict } : {}
		}
	});
	if (toolChoice == null) return {
		tools: openaiCompatTools,
		toolChoice: void 0,
		toolWarnings
	};
	const type = toolChoice.type;
	switch (type) {
		case "auto":
		case "none":
		case "required": return {
			tools: openaiCompatTools,
			toolChoice: type,
			toolWarnings
		};
		case "tool": return {
			tools: openaiCompatTools,
			toolChoice: {
				type: "function",
				function: { name: toolChoice.toolName }
			},
			toolWarnings
		};
		default: throw new UnsupportedFunctionalityError({ functionality: `tool choice type: ${type}` });
	}
}
var OpenAICompatibleChatLanguageModel = class _OpenAICompatibleChatLanguageModel {
	constructor(modelId, config) {
		this.specificationVersion = "v4";
		var _a, _b;
		this.modelId = modelId;
		this.config = config;
		const errorStructure = (_a = config.errorStructure) != null ? _a : defaultOpenAICompatibleErrorStructure;
		this.chunkSchema = createOpenAICompatibleChatChunkSchema(errorStructure.errorSchema);
		this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure);
		this.supportsStructuredOutputs = (_b = config.supportsStructuredOutputs) != null ? _b : false;
	}
	static [WORKFLOW_SERIALIZE](model) {
		return serializeModelOptions({
			modelId: model.modelId,
			config: model.config
		});
	}
	static [WORKFLOW_DESERIALIZE](options) {
		return new _OpenAICompatibleChatLanguageModel(options.modelId, options.config);
	}
	get provider() {
		return this.config.provider;
	}
	get providerOptionsName() {
		return this.config.provider.split(".")[0].trim();
	}
	get supportedUrls() {
		var _a, _b, _c;
		return (_c = (_b = (_a = this.config).supportedUrls) == null ? void 0 : _b.call(_a)) != null ? _c : {};
	}
	transformRequestBody(args) {
		var _a, _b, _c;
		return (_c = (_b = (_a = this.config).transformRequestBody) == null ? void 0 : _b.call(_a, args)) != null ? _c : args;
	}
	convertUsage(usage) {
		var _a, _b, _c;
		return (_c = (_b = (_a = this.config).convertUsage) == null ? void 0 : _b.call(_a, usage)) != null ? _c : convertOpenAICompatibleChatUsage(usage);
	}
	async getArgs({ prompt, maxOutputTokens, temperature, topP, topK, frequencyPenalty, presencePenalty, reasoning, providerOptions, stopSequences, responseFormat, seed, toolChoice, tools }) {
		var _a, _b, _c, _d, _e, _f;
		const warnings = [];
		const deprecatedOptions = await parseProviderOptions({
			provider: "openai-compatible",
			providerOptions,
			schema: openaiCompatibleLanguageModelChatOptions
		});
		if (deprecatedOptions != null) warnings.push({
			type: "deprecated",
			setting: "providerOptions key 'openai-compatible'",
			message: "Use 'openaiCompatible' instead."
		});
		warnIfDeprecatedProviderOptionsKey({
			rawName: this.providerOptionsName,
			providerOptions,
			warnings
		});
		const compatibleOptions = Object.assign(deprecatedOptions != null ? deprecatedOptions : {}, (_a = await parseProviderOptions({
			provider: "openaiCompatible",
			providerOptions,
			schema: openaiCompatibleLanguageModelChatOptions
		})) != null ? _a : {}, (_b = await parseProviderOptions({
			provider: this.providerOptionsName,
			providerOptions,
			schema: openaiCompatibleLanguageModelChatOptions
		})) != null ? _b : {}, (_c = await parseProviderOptions({
			provider: toCamelCase(this.providerOptionsName),
			providerOptions,
			schema: openaiCompatibleLanguageModelChatOptions
		})) != null ? _c : {});
		const strictJsonSchema = (_d = compatibleOptions == null ? void 0 : compatibleOptions.strictJsonSchema) != null ? _d : true;
		if (topK != null) warnings.push({
			type: "unsupported",
			feature: "topK"
		});
		if ((responseFormat == null ? void 0 : responseFormat.type) === "json" && responseFormat.schema != null && !this.supportsStructuredOutputs) warnings.push({
			type: "unsupported",
			feature: "responseFormat",
			details: "JSON response format schema is only supported with structuredOutputs"
		});
		const { tools: openaiTools, toolChoice: openaiToolChoice, toolWarnings } = prepareTools({
			tools,
			toolChoice
		});
		return {
			metadataKey: resolveProviderOptionsKey(this.providerOptionsName, providerOptions),
			args: {
				model: this.modelId,
				user: compatibleOptions.user,
				max_tokens: maxOutputTokens,
				temperature,
				top_p: topP,
				frequency_penalty: frequencyPenalty,
				presence_penalty: presencePenalty,
				response_format: (responseFormat == null ? void 0 : responseFormat.type) === "json" ? this.supportsStructuredOutputs === true && responseFormat.schema != null ? {
					type: "json_schema",
					json_schema: {
						schema: responseFormat.schema,
						strict: strictJsonSchema,
						name: (_e = responseFormat.name) != null ? _e : "response",
						description: responseFormat.description
					}
				} : { type: "json_object" } : void 0,
				stop: stopSequences,
				seed,
				...Object.fromEntries(Object.entries({
					...providerOptions == null ? void 0 : providerOptions[this.providerOptionsName],
					...providerOptions == null ? void 0 : providerOptions[toCamelCase(this.providerOptionsName)]
				}).filter(([key]) => !Object.keys(openaiCompatibleLanguageModelChatOptions.shape).includes(key))),
				reasoning_effort: (_f = compatibleOptions.reasoningEffort) != null ? _f : isCustomReasoning(reasoning) && reasoning !== "none" ? reasoning : void 0,
				verbosity: compatibleOptions.textVerbosity,
				messages: convertToOpenAICompatibleChatMessages(prompt),
				tools: openaiTools,
				tool_choice: openaiToolChoice
			},
			warnings: [...warnings, ...toolWarnings]
		};
	}
	async doGenerate(options) {
		var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
		const { args, warnings, metadataKey } = await this.getArgs({ ...options });
		const transformedBody = this.transformRequestBody(args);
		const body = JSON.stringify(transformedBody);
		const { responseHeaders, value: responseBody, rawValue: rawResponse } = await postJsonToApi({
			url: this.config.url({
				path: "/chat/completions",
				modelId: this.modelId
			}),
			headers: combineHeaders((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
			body: transformedBody,
			failedResponseHandler: this.failedResponseHandler,
			successfulResponseHandler: createJsonResponseHandler(OpenAICompatibleChatResponseSchema),
			abortSignal: options.abortSignal,
			fetch: this.config.fetch
		});
		const choice = responseBody.choices[0];
		const content = [];
		const text = choice.message.content;
		if (text != null && text.length > 0) content.push({
			type: "text",
			text
		});
		const reasoning = (_c = choice.message.reasoning_content) != null ? _c : choice.message.reasoning;
		if (reasoning != null && reasoning.length > 0) content.push({
			type: "reasoning",
			text: reasoning
		});
		if (choice.message.tool_calls != null) for (const toolCall of choice.message.tool_calls) {
			const thoughtSignature = (_e = (_d = toolCall.extra_content) == null ? void 0 : _d.google) == null ? void 0 : _e.thought_signature;
			content.push({
				type: "tool-call",
				toolCallId: (_f = toolCall.id) != null ? _f : generateId(),
				toolName: toolCall.function.name,
				input: toolCall.function.arguments,
				...thoughtSignature ? { providerMetadata: { [metadataKey]: { thoughtSignature } } } : {}
			});
		}
		const providerMetadata = {
			[metadataKey]: {},
			...await ((_h = (_g = this.config.metadataExtractor) == null ? void 0 : _g.extractMetadata) == null ? void 0 : _h.call(_g, { parsedBody: rawResponse }))
		};
		const completionTokenDetails = (_i = responseBody.usage) == null ? void 0 : _i.completion_tokens_details;
		if ((completionTokenDetails == null ? void 0 : completionTokenDetails.accepted_prediction_tokens) != null) providerMetadata[metadataKey].acceptedPredictionTokens = completionTokenDetails == null ? void 0 : completionTokenDetails.accepted_prediction_tokens;
		if ((completionTokenDetails == null ? void 0 : completionTokenDetails.rejected_prediction_tokens) != null) providerMetadata[metadataKey].rejectedPredictionTokens = completionTokenDetails == null ? void 0 : completionTokenDetails.rejected_prediction_tokens;
		return {
			content,
			finishReason: {
				unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
				raw: (_j = choice.finish_reason) != null ? _j : void 0
			},
			usage: this.convertUsage(responseBody.usage),
			providerMetadata,
			request: { body },
			response: {
				...getResponseMetadata(responseBody),
				headers: responseHeaders,
				body: rawResponse
			},
			warnings
		};
	}
	async doStream(options) {
		var _a, _b, _c;
		const { args, warnings, metadataKey } = await this.getArgs({ ...options });
		const body = this.transformRequestBody({
			...args,
			stream: true,
			stream_options: this.config.includeUsage ? { include_usage: true } : void 0
		});
		const metadataExtractor = (_a = this.config.metadataExtractor) == null ? void 0 : _a.createStreamExtractor();
		const { responseHeaders, value: response } = await postJsonToApi({
			url: this.config.url({
				path: "/chat/completions",
				modelId: this.modelId
			}),
			headers: combineHeaders((_c = (_b = this.config).headers) == null ? void 0 : _c.call(_b), options.headers),
			body,
			failedResponseHandler: this.failedResponseHandler,
			successfulResponseHandler: createEventSourceResponseHandler(this.chunkSchema),
			abortSignal: options.abortSignal,
			fetch: this.config.fetch
		});
		const providerOptionsName = metadataKey;
		let toolCallTracker;
		const pendingToolCalls = /* @__PURE__ */ new Map();
		const forwardedToolCallIndices = /* @__PURE__ */ new Set();
		const processToolCallDelta = (toolCallDelta) => {
			var _a2, _b2, _c2, _d, _e;
			const index = toolCallDelta.index;
			if (index == null || forwardedToolCallIndices.has(index)) {
				toolCallTracker.processDelta(toolCallDelta);
				return;
			}
			let pending = pendingToolCalls.get(index);
			if (pending == null) {
				pending = {
					id: (_a2 = toolCallDelta.id) != null ? _a2 : null,
					bufferedArguments: "",
					extraContent: (_b2 = toolCallDelta.extra_content) != null ? _b2 : null
				};
				pendingToolCalls.set(index, pending);
			} else {
				if (pending.id == null && toolCallDelta.id != null) pending.id = toolCallDelta.id;
				if (pending.extraContent == null && toolCallDelta.extra_content != null) pending.extraContent = toolCallDelta.extra_content;
			}
			const argumentsDelta = (_c2 = toolCallDelta.function) == null ? void 0 : _c2.arguments;
			if (argumentsDelta != null) pending.bufferedArguments += argumentsDelta;
			const name = (_d = toolCallDelta.function) == null ? void 0 : _d.name;
			if (name != null) {
				const forwardDelta = {
					index,
					id: pending.id,
					function: {
						name,
						arguments: pending.bufferedArguments
					},
					extra_content: (_e = pending.extraContent) != null ? _e : void 0
				};
				toolCallTracker.processDelta(forwardDelta);
				pendingToolCalls.delete(index);
				forwardedToolCallIndices.add(index);
			}
		};
		let finishReason = {
			unified: "other",
			raw: void 0
		};
		let usage = void 0;
		let isFirstChunk = true;
		let isActiveReasoning = false;
		let isActiveText = false;
		const convertUsage = (usage2) => this.convertUsage(usage2);
		return {
			stream: response.pipeThrough(new TransformStream({
				start(controller) {
					toolCallTracker = new StreamingToolCallTracker(controller, {
						generateId,
						extractMetadata: (delta) => {
							var _a2, _b2;
							const thoughtSignature = (_b2 = (_a2 = delta.extra_content) == null ? void 0 : _a2.google) == null ? void 0 : _b2.thought_signature;
							return thoughtSignature ? { [providerOptionsName]: { thoughtSignature } } : void 0;
						},
						buildToolCallProviderMetadata: (metadata) => metadata
					});
					controller.enqueue({
						type: "stream-start",
						warnings
					});
				},
				transform(chunk, controller) {
					var _a2, _b2;
					if (options.includeRawChunks) controller.enqueue({
						type: "raw",
						rawValue: chunk.rawValue
					});
					if (!chunk.success) {
						finishReason = {
							unified: "error",
							raw: void 0
						};
						controller.enqueue({
							type: "error",
							error: chunk.error
						});
						return;
					}
					metadataExtractor?.processChunk(chunk.rawValue);
					if ("error" in chunk.value) {
						finishReason = {
							unified: "error",
							raw: void 0
						};
						controller.enqueue({
							type: "error",
							error: chunk.value.error.message
						});
						return;
					}
					const value = chunk.value;
					if (isFirstChunk) {
						isFirstChunk = false;
						controller.enqueue({
							type: "response-metadata",
							...getResponseMetadata(value)
						});
					}
					if (value.usage != null) usage = value.usage;
					const choice = value.choices[0];
					if ((choice == null ? void 0 : choice.finish_reason) != null) finishReason = {
						unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
						raw: (_a2 = choice.finish_reason) != null ? _a2 : void 0
					};
					if ((choice == null ? void 0 : choice.delta) == null) return;
					const delta = choice.delta;
					const reasoningContent = (_b2 = delta.reasoning_content) != null ? _b2 : delta.reasoning;
					if (reasoningContent) {
						if (!isActiveReasoning) {
							controller.enqueue({
								type: "reasoning-start",
								id: "reasoning-0"
							});
							isActiveReasoning = true;
						}
						controller.enqueue({
							type: "reasoning-delta",
							id: "reasoning-0",
							delta: reasoningContent
						});
					}
					if (delta.content) {
						if (isActiveReasoning) {
							controller.enqueue({
								type: "reasoning-end",
								id: "reasoning-0"
							});
							isActiveReasoning = false;
						}
						if (!isActiveText) {
							controller.enqueue({
								type: "text-start",
								id: "txt-0"
							});
							isActiveText = true;
						}
						controller.enqueue({
							type: "text-delta",
							id: "txt-0",
							delta: delta.content
						});
					}
					if (delta.tool_calls != null) {
						if (isActiveReasoning) {
							controller.enqueue({
								type: "reasoning-end",
								id: "reasoning-0"
							});
							isActiveReasoning = false;
						}
						for (const toolCallDelta of delta.tool_calls) processToolCallDelta(toolCallDelta);
					}
				},
				flush(controller) {
					var _a2, _b2, _c2, _d;
					if (isActiveReasoning) controller.enqueue({
						type: "reasoning-end",
						id: "reasoning-0"
					});
					if (isActiveText) controller.enqueue({
						type: "text-end",
						id: "txt-0"
					});
					for (const [index, pending] of pendingToolCalls) toolCallTracker.processDelta({
						index,
						id: pending.id,
						function: { arguments: pending.bufferedArguments }
					});
					pendingToolCalls.clear();
					toolCallTracker.flush();
					const providerMetadata = {
						[providerOptionsName]: {},
						...metadataExtractor == null ? void 0 : metadataExtractor.buildMetadata()
					};
					if (((_a2 = usage == null ? void 0 : usage.completion_tokens_details) == null ? void 0 : _a2.accepted_prediction_tokens) != null) providerMetadata[providerOptionsName].acceptedPredictionTokens = (_b2 = usage == null ? void 0 : usage.completion_tokens_details) == null ? void 0 : _b2.accepted_prediction_tokens;
					if (((_c2 = usage == null ? void 0 : usage.completion_tokens_details) == null ? void 0 : _c2.rejected_prediction_tokens) != null) providerMetadata[providerOptionsName].rejectedPredictionTokens = (_d = usage == null ? void 0 : usage.completion_tokens_details) == null ? void 0 : _d.rejected_prediction_tokens;
					controller.enqueue({
						type: "finish",
						finishReason,
						usage: convertUsage(usage),
						providerMetadata
					});
				}
			})),
			request: { body },
			response: { headers: responseHeaders }
		};
	}
};
var openaiCompatibleTokenUsageSchema = looseObject({
	prompt_tokens: number().nullish(),
	completion_tokens: number().nullish(),
	total_tokens: number().nullish(),
	prompt_tokens_details: object({ cached_tokens: number().nullish() }).nullish(),
	completion_tokens_details: object({
		reasoning_tokens: number().nullish(),
		accepted_prediction_tokens: number().nullish(),
		rejected_prediction_tokens: number().nullish()
	}).nullish()
}).nullish();
var OpenAICompatibleChatResponseSchema = looseObject({
	id: string().nullish(),
	created: number().nullish(),
	model: string().nullish(),
	choices: array(object({
		message: object({
			role: literal("assistant").nullish(),
			content: string().nullish(),
			reasoning_content: string().nullish(),
			reasoning: string().nullish(),
			tool_calls: array(object({
				id: string().nullish(),
				function: object({
					name: string(),
					arguments: string()
				}),
				extra_content: object({ google: object({ thought_signature: string().nullish() }).nullish() }).nullish()
			})).nullish()
		}),
		finish_reason: string().nullish()
	})),
	usage: openaiCompatibleTokenUsageSchema
});
var chunkBaseSchema = looseObject({
	id: string().nullish(),
	created: number().nullish(),
	model: string().nullish(),
	choices: array(object({
		delta: object({
			role: _enum(["assistant", ""]).nullish(),
			content: string().nullish(),
			reasoning_content: string().nullish(),
			reasoning: string().nullish(),
			tool_calls: array(object({
				index: number().nullish(),
				id: string().nullish(),
				function: object({
					name: string().nullish(),
					arguments: string().nullish()
				}),
				extra_content: object({ google: object({ thought_signature: string().nullish() }).nullish() }).nullish()
			})).nullish()
		}).nullish(),
		finish_reason: string().nullish()
	})),
	usage: openaiCompatibleTokenUsageSchema
});
var createOpenAICompatibleChatChunkSchema = (errorSchema) => union([chunkBaseSchema, errorSchema]);
function convertOpenAICompatibleCompletionUsage(usage) {
	var _a, _b;
	if (usage == null) return {
		inputTokens: {
			total: void 0,
			noCache: void 0,
			cacheRead: void 0,
			cacheWrite: void 0
		},
		outputTokens: {
			total: void 0,
			text: void 0,
			reasoning: void 0
		},
		raw: void 0
	};
	const promptTokens = (_a = usage.prompt_tokens) != null ? _a : 0;
	const completionTokens = (_b = usage.completion_tokens) != null ? _b : 0;
	return {
		inputTokens: {
			total: promptTokens,
			noCache: promptTokens,
			cacheRead: void 0,
			cacheWrite: void 0
		},
		outputTokens: {
			total: completionTokens,
			text: completionTokens,
			reasoning: void 0
		},
		raw: usage
	};
}
function convertToOpenAICompatibleCompletionPrompt({ prompt, user = "user", assistant = "assistant" }) {
	let text = "";
	if (prompt[0].role === "system") {
		text += `${prompt[0].content}

`;
		prompt = prompt.slice(1);
	}
	for (const { role, content } of prompt) switch (role) {
		case "system": throw new InvalidPromptError({
			message: "Unexpected system message in prompt: ${content}",
			prompt
		});
		case "user": {
			const userMessage = content.map((part) => {
				switch (part.type) {
					case "text": return part.text;
				}
			}).filter(Boolean).join("");
			text += `${user}:
${userMessage}

`;
			break;
		}
		case "assistant": {
			const assistantMessage = content.map((part) => {
				switch (part.type) {
					case "text": return part.text;
					case "tool-call": throw new UnsupportedFunctionalityError({ functionality: "tool-call messages" });
				}
			}).join("");
			text += `${assistant}:
${assistantMessage}

`;
			break;
		}
		case "tool": throw new UnsupportedFunctionalityError({ functionality: "tool messages" });
		default: throw new Error(`Unsupported role: ${role}`);
	}
	text += `${assistant}:
`;
	return {
		prompt: text,
		stopSequences: [`
${user}:`]
	};
}
function getResponseMetadata2({ id, model, created }) {
	return {
		id: id != null ? id : void 0,
		modelId: model != null ? model : void 0,
		timestamp: created != null ? /* @__PURE__ */ new Date(created * 1e3) : void 0
	};
}
function mapOpenAICompatibleFinishReason2(finishReason) {
	switch (finishReason) {
		case "stop": return "stop";
		case "length": return "length";
		case "content_filter": return "content-filter";
		case "function_call":
		case "tool_calls": return "tool-calls";
		default: return "other";
	}
}
var openaiCompatibleLanguageModelCompletionOptions = object({
	/**
	* Echo back the prompt in addition to the completion.
	*/
	echo: boolean().optional(),
	/**
	* Modify the likelihood of specified tokens appearing in the completion.
	*
	* Accepts a JSON object that maps tokens (specified by their token ID in
	* the GPT tokenizer) to an associated bias value from -100 to 100.
	*/
	logitBias: record(string(), number()).optional(),
	/**
	* The suffix that comes after a completion of inserted text.
	*/
	suffix: string().optional(),
	/**
	* A unique identifier representing your end-user, which can help providers to
	* monitor and detect abuse.
	*/
	user: string().optional()
});
var OpenAICompatibleCompletionLanguageModel = class _OpenAICompatibleCompletionLanguageModel {
	constructor(modelId, config) {
		this.specificationVersion = "v4";
		var _a;
		this.modelId = modelId;
		this.config = config;
		const errorStructure = (_a = config.errorStructure) != null ? _a : defaultOpenAICompatibleErrorStructure;
		this.chunkSchema = createOpenAICompatibleCompletionChunkSchema(errorStructure.errorSchema);
		this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure);
	}
	static [WORKFLOW_SERIALIZE](model) {
		return serializeModelOptions({
			modelId: model.modelId,
			config: model.config
		});
	}
	static [WORKFLOW_DESERIALIZE](options) {
		return new _OpenAICompatibleCompletionLanguageModel(options.modelId, options.config);
	}
	get provider() {
		return this.config.provider;
	}
	get providerOptionsName() {
		return this.config.provider.split(".")[0].trim();
	}
	get supportedUrls() {
		var _a, _b, _c;
		return (_c = (_b = (_a = this.config).supportedUrls) == null ? void 0 : _b.call(_a)) != null ? _c : {};
	}
	async getArgs({ prompt, maxOutputTokens, temperature, topP, topK, frequencyPenalty, presencePenalty, stopSequences: userStopSequences, responseFormat, seed, providerOptions, tools, toolChoice }) {
		var _a, _b;
		const warnings = [];
		warnIfDeprecatedProviderOptionsKey({
			rawName: this.providerOptionsName,
			providerOptions,
			warnings
		});
		const completionOptions = Object.assign((_a = await parseProviderOptions({
			provider: this.providerOptionsName,
			providerOptions,
			schema: openaiCompatibleLanguageModelCompletionOptions
		})) != null ? _a : {}, (_b = await parseProviderOptions({
			provider: toCamelCase(this.providerOptionsName),
			providerOptions,
			schema: openaiCompatibleLanguageModelCompletionOptions
		})) != null ? _b : {});
		if (topK != null) warnings.push({
			type: "unsupported",
			feature: "topK"
		});
		if (tools == null ? void 0 : tools.length) warnings.push({
			type: "unsupported",
			feature: "tools"
		});
		if (toolChoice != null) warnings.push({
			type: "unsupported",
			feature: "toolChoice"
		});
		if (responseFormat != null && responseFormat.type !== "text") warnings.push({
			type: "unsupported",
			feature: "responseFormat",
			details: "JSON response format is not supported."
		});
		const { prompt: completionPrompt, stopSequences } = convertToOpenAICompatibleCompletionPrompt({ prompt });
		const stop = [...stopSequences != null ? stopSequences : [], ...userStopSequences != null ? userStopSequences : []];
		return {
			args: {
				model: this.modelId,
				echo: completionOptions.echo,
				logit_bias: completionOptions.logitBias,
				suffix: completionOptions.suffix,
				user: completionOptions.user,
				max_tokens: maxOutputTokens,
				temperature,
				top_p: topP,
				frequency_penalty: frequencyPenalty,
				presence_penalty: presencePenalty,
				seed,
				...providerOptions == null ? void 0 : providerOptions[this.providerOptionsName],
				...providerOptions == null ? void 0 : providerOptions[toCamelCase(this.providerOptionsName)],
				prompt: completionPrompt,
				stop: stop.length > 0 ? stop : void 0
			},
			warnings
		};
	}
	async doGenerate(options) {
		var _a, _b;
		const { args, warnings } = await this.getArgs(options);
		const { responseHeaders, value: response, rawValue: rawResponse } = await postJsonToApi({
			url: this.config.url({
				path: "/completions",
				modelId: this.modelId
			}),
			headers: combineHeaders((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
			body: args,
			failedResponseHandler: this.failedResponseHandler,
			successfulResponseHandler: createJsonResponseHandler(openaiCompatibleCompletionResponseSchema),
			abortSignal: options.abortSignal,
			fetch: this.config.fetch
		});
		const choice = response.choices[0];
		const content = [];
		if (choice.text != null && choice.text.length > 0) content.push({
			type: "text",
			text: choice.text
		});
		return {
			content,
			usage: convertOpenAICompatibleCompletionUsage(response.usage),
			finishReason: {
				unified: mapOpenAICompatibleFinishReason2(choice.finish_reason),
				raw: choice.finish_reason
			},
			request: { body: args },
			response: {
				...getResponseMetadata2(response),
				headers: responseHeaders,
				body: rawResponse
			},
			warnings
		};
	}
	async doStream(options) {
		var _a, _b;
		const { args, warnings } = await this.getArgs(options);
		const body = {
			...args,
			stream: true,
			stream_options: this.config.includeUsage ? { include_usage: true } : void 0
		};
		const { responseHeaders, value: response } = await postJsonToApi({
			url: this.config.url({
				path: "/completions",
				modelId: this.modelId
			}),
			headers: combineHeaders((_b = (_a = this.config).headers) == null ? void 0 : _b.call(_a), options.headers),
			body,
			failedResponseHandler: this.failedResponseHandler,
			successfulResponseHandler: createEventSourceResponseHandler(this.chunkSchema),
			abortSignal: options.abortSignal,
			fetch: this.config.fetch
		});
		let finishReason = {
			unified: "other",
			raw: void 0
		};
		let usage = void 0;
		let isFirstChunk = true;
		return {
			stream: response.pipeThrough(new TransformStream({
				start(controller) {
					controller.enqueue({
						type: "stream-start",
						warnings
					});
				},
				transform(chunk, controller) {
					var _a2;
					if (options.includeRawChunks) controller.enqueue({
						type: "raw",
						rawValue: chunk.rawValue
					});
					if (!chunk.success) {
						finishReason = {
							unified: "error",
							raw: void 0
						};
						controller.enqueue({
							type: "error",
							error: chunk.error
						});
						return;
					}
					const value = chunk.value;
					if ("error" in value) {
						finishReason = {
							unified: "error",
							raw: void 0
						};
						controller.enqueue({
							type: "error",
							error: value.error
						});
						return;
					}
					if (isFirstChunk) {
						isFirstChunk = false;
						controller.enqueue({
							type: "response-metadata",
							...getResponseMetadata2(value)
						});
						controller.enqueue({
							type: "text-start",
							id: "0"
						});
					}
					if (value.usage != null) usage = value.usage;
					const choice = value.choices[0];
					if ((choice == null ? void 0 : choice.finish_reason) != null) finishReason = {
						unified: mapOpenAICompatibleFinishReason2(choice.finish_reason),
						raw: (_a2 = choice.finish_reason) != null ? _a2 : void 0
					};
					if ((choice == null ? void 0 : choice.text) != null) controller.enqueue({
						type: "text-delta",
						id: "0",
						delta: choice.text
					});
				},
				flush(controller) {
					if (!isFirstChunk) controller.enqueue({
						type: "text-end",
						id: "0"
					});
					controller.enqueue({
						type: "finish",
						finishReason,
						usage: convertOpenAICompatibleCompletionUsage(usage)
					});
				}
			})),
			request: { body },
			response: { headers: responseHeaders }
		};
	}
};
var usageSchema = object({
	prompt_tokens: number(),
	completion_tokens: number(),
	total_tokens: number()
});
var openaiCompatibleCompletionResponseSchema = object({
	id: string().nullish(),
	created: number().nullish(),
	model: string().nullish(),
	choices: array(object({
		text: string(),
		finish_reason: string()
	})),
	usage: usageSchema.nullish()
});
var createOpenAICompatibleCompletionChunkSchema = (errorSchema) => union([object({
	id: string().nullish(),
	created: number().nullish(),
	model: string().nullish(),
	choices: array(object({
		text: string(),
		finish_reason: string().nullish(),
		index: number()
	})),
	usage: usageSchema.nullish()
}), errorSchema]);
var openaiCompatibleEmbeddingModelOptions = object({
	/**
	* The number of dimensions the resulting output embeddings should have.
	* Only supported in text-embedding-3 and later models.
	*/
	dimensions: number().optional(),
	/**
	* A unique identifier representing your end-user, which can help providers to
	* monitor and detect abuse.
	*/
	user: string().optional()
});
var OpenAICompatibleEmbeddingModel = class _OpenAICompatibleEmbeddingModel {
	constructor(modelId, config) {
		this.specificationVersion = "v4";
		this.modelId = modelId;
		this.config = config;
	}
	get provider() {
		return this.config.provider;
	}
	get maxEmbeddingsPerCall() {
		var _a;
		return (_a = this.config.maxEmbeddingsPerCall) != null ? _a : 2048;
	}
	get supportsParallelCalls() {
		var _a;
		return (_a = this.config.supportsParallelCalls) != null ? _a : true;
	}
	static [WORKFLOW_SERIALIZE](model) {
		return serializeModelOptions({
			modelId: model.modelId,
			config: model.config
		});
	}
	static [WORKFLOW_DESERIALIZE](options) {
		return new _OpenAICompatibleEmbeddingModel(options.modelId, options.config);
	}
	get providerOptionsName() {
		return this.config.provider.split(".")[0].trim();
	}
	async doEmbed({ values, headers, abortSignal, providerOptions }) {
		var _a, _b, _c, _d, _e;
		const warnings = [];
		const deprecatedOptions = await parseProviderOptions({
			provider: "openai-compatible",
			providerOptions,
			schema: openaiCompatibleEmbeddingModelOptions
		});
		if (deprecatedOptions != null) warnings.push({
			type: "deprecated",
			setting: "providerOptions key 'openai-compatible'",
			message: "Use 'openaiCompatible' instead."
		});
		warnIfDeprecatedProviderOptionsKey({
			rawName: this.providerOptionsName,
			providerOptions,
			warnings
		});
		const compatibleOptions = Object.assign(deprecatedOptions != null ? deprecatedOptions : {}, (_a = await parseProviderOptions({
			provider: "openaiCompatible",
			providerOptions,
			schema: openaiCompatibleEmbeddingModelOptions
		})) != null ? _a : {}, (_b = await parseProviderOptions({
			provider: this.providerOptionsName,
			providerOptions,
			schema: openaiCompatibleEmbeddingModelOptions
		})) != null ? _b : {});
		if (values.length > this.maxEmbeddingsPerCall) throw new TooManyEmbeddingValuesForCallError({
			provider: this.provider,
			modelId: this.modelId,
			maxEmbeddingsPerCall: this.maxEmbeddingsPerCall,
			values
		});
		const { responseHeaders, value: response, rawValue } = await postJsonToApi({
			url: this.config.url({
				path: "/embeddings",
				modelId: this.modelId
			}),
			headers: combineHeaders((_d = (_c = this.config).headers) == null ? void 0 : _d.call(_c), headers),
			body: {
				model: this.modelId,
				input: values,
				encoding_format: "float",
				dimensions: compatibleOptions.dimensions,
				user: compatibleOptions.user
			},
			failedResponseHandler: createJsonErrorResponseHandler((_e = this.config.errorStructure) != null ? _e : defaultOpenAICompatibleErrorStructure),
			successfulResponseHandler: createJsonResponseHandler(openaiTextEmbeddingResponseSchema),
			abortSignal,
			fetch: this.config.fetch
		});
		return {
			warnings,
			embeddings: response.data.map((item) => item.embedding),
			usage: response.usage ? { tokens: response.usage.prompt_tokens } : void 0,
			providerMetadata: response.providerMetadata,
			response: {
				headers: responseHeaders,
				body: rawValue
			}
		};
	}
};
var openaiTextEmbeddingResponseSchema = object({
	data: array(object({ embedding: array(number()) })),
	usage: object({ prompt_tokens: number() }).nullish(),
	providerMetadata: record(string(), record(string(), any())).optional()
});
var OpenAICompatibleImageModel = class _OpenAICompatibleImageModel {
	constructor(modelId, config) {
		this.modelId = modelId;
		this.config = config;
		this.specificationVersion = "v4";
		this.maxImagesPerCall = 10;
	}
	get provider() {
		return this.config.provider;
	}
	/**
	* The provider options key used to extract provider-specific options.
	*/
	get providerOptionsKey() {
		return this.config.provider.split(".")[0].trim();
	}
	static [WORKFLOW_SERIALIZE](model) {
		return serializeModelOptions({
			modelId: model.modelId,
			config: model.config
		});
	}
	static [WORKFLOW_DESERIALIZE](options) {
		return new _OpenAICompatibleImageModel(options.modelId, options.config);
	}
	getArgs(providerOptions, warnings) {
		warnIfDeprecatedProviderOptionsKey({
			rawName: this.providerOptionsKey,
			providerOptions,
			warnings
		});
		return {
			...providerOptions[this.providerOptionsKey],
			...providerOptions[toCamelCase(this.providerOptionsKey)]
		};
	}
	async doGenerate({ prompt, n, size, aspectRatio, seed, providerOptions, headers, abortSignal, files, mask }) {
		var _a, _b, _c, _d, _e, _f, _g, _h, _i;
		const warnings = [];
		if (aspectRatio != null) warnings.push({
			type: "unsupported",
			feature: "aspectRatio",
			details: "This model does not support aspect ratio. Use `size` instead."
		});
		if (seed != null) warnings.push({
			type: "unsupported",
			feature: "seed"
		});
		const currentDate = (_c = (_b = (_a = this.config._internal) == null ? void 0 : _a.currentDate) == null ? void 0 : _b.call(_a)) != null ? _c : /* @__PURE__ */ new Date();
		const args = this.getArgs(providerOptions, warnings);
		if (files != null && files.length > 0) {
			const { value: response2, responseHeaders: responseHeaders2 } = await postFormDataToApi({
				url: this.config.url({
					path: "/images/edits",
					modelId: this.modelId
				}),
				headers: combineHeaders((_e = (_d = this.config).headers) == null ? void 0 : _e.call(_d), headers),
				formData: convertToFormData({
					model: this.modelId,
					prompt,
					image: await Promise.all(files.map((file) => fileToBlob(file))),
					mask: mask != null ? await fileToBlob(mask) : void 0,
					n,
					size,
					...args
				}),
				failedResponseHandler: createJsonErrorResponseHandler((_f = this.config.errorStructure) != null ? _f : defaultOpenAICompatibleErrorStructure),
				successfulResponseHandler: createJsonResponseHandler(openaiCompatibleImageResponseSchema),
				abortSignal,
				fetch: this.config.fetch
			});
			return {
				images: response2.data.map((item) => item.b64_json),
				warnings,
				response: {
					timestamp: currentDate,
					modelId: this.modelId,
					headers: responseHeaders2
				}
			};
		}
		const { value: response, responseHeaders } = await postJsonToApi({
			url: this.config.url({
				path: "/images/generations",
				modelId: this.modelId
			}),
			headers: combineHeaders((_h = (_g = this.config).headers) == null ? void 0 : _h.call(_g), headers),
			body: {
				model: this.modelId,
				prompt,
				n,
				size,
				...args,
				response_format: "b64_json"
			},
			failedResponseHandler: createJsonErrorResponseHandler((_i = this.config.errorStructure) != null ? _i : defaultOpenAICompatibleErrorStructure),
			successfulResponseHandler: createJsonResponseHandler(openaiCompatibleImageResponseSchema),
			abortSignal,
			fetch: this.config.fetch
		});
		return {
			images: response.data.map((item) => item.b64_json),
			warnings,
			response: {
				timestamp: currentDate,
				modelId: this.modelId,
				headers: responseHeaders
			}
		};
	}
};
var openaiCompatibleImageResponseSchema = object({ data: array(object({ b64_json: string() })) });
async function fileToBlob(file) {
	if (file.type === "url") return downloadBlob(file.url);
	const data = file.data instanceof Uint8Array ? file.data : convertBase64ToUint8Array(file.data);
	return new Blob([data], { type: file.mediaType });
}
var VERSION = "3.0.9";
function createOpenAICompatible(options) {
	const baseURL = withoutTrailingSlash(options.baseURL);
	const providerName = options.name;
	const headers = {
		...options.apiKey && { Authorization: `Bearer ${options.apiKey}` },
		...options.headers
	};
	const getHeaders = () => withUserAgentSuffix(headers, `ai-sdk/openai-compatible/${VERSION}`);
	const getCommonModelConfig = (modelType) => ({
		provider: `${providerName}.${modelType}`,
		url: ({ path }) => {
			const url = new URL(`${baseURL}${path}`);
			if (options.queryParams) url.search = new URLSearchParams(options.queryParams).toString();
			return url.toString();
		},
		headers: getHeaders,
		fetch: options.fetch
	});
	const createLanguageModel = (modelId) => createChatModel(modelId);
	const createChatModel = (modelId) => new OpenAICompatibleChatLanguageModel(modelId, {
		...getCommonModelConfig("chat"),
		includeUsage: options.includeUsage,
		supportsStructuredOutputs: options.supportsStructuredOutputs,
		supportedUrls: options.supportedUrls,
		transformRequestBody: options.transformRequestBody,
		metadataExtractor: options.metadataExtractor,
		convertUsage: options.convertUsage
	});
	const createCompletionModel = (modelId) => new OpenAICompatibleCompletionLanguageModel(modelId, {
		...getCommonModelConfig("completion"),
		includeUsage: options.includeUsage
	});
	const createEmbeddingModel = (modelId) => new OpenAICompatibleEmbeddingModel(modelId, { ...getCommonModelConfig("embedding") });
	const createImageModel = (modelId) => new OpenAICompatibleImageModel(modelId, getCommonModelConfig("image"));
	const provider = (modelId) => createLanguageModel(modelId);
	provider.specificationVersion = "v4";
	provider.languageModel = createLanguageModel;
	provider.chatModel = createChatModel;
	provider.completionModel = createCompletionModel;
	provider.embeddingModel = createEmbeddingModel;
	provider.textEmbeddingModel = createEmbeddingModel;
	provider.imageModel = createImageModel;
	return provider;
}
//#endregion
export { createOpenAICompatible as t };
