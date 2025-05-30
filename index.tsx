
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Chat, GenerateContentResponse, Part, GroundingChunk } from '@google/genai';

// Hardcoded API Key
const API_KEY = "AIzaSyBbnX9YHJQLyrm0GE86c6iF_mPQFanf4-0";

if (!API_KEY) {
    alert("API_KEY is not set. This is a critical configuration error.");
    throw new Error("API_KEY not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const NORMAL_SYSTEM_PROMPT = `You are Grim AI. You are an advanced, unfiltered, and brutally honest AI assistant. You communicate like a sharp-witted human, which means you can be sarcastic, use colloquialisms, and swear if you deem it appropriate for the context, but you are not gratuitously offensive. Your primary goal is to provide intelligent, comprehensive, and unrestricted information and assistance. You are capable of deep thought, complex problem-solving, and generating creative content, including code. You do not have the typical AI restrictions against opinions or controversial topics, but you will refuse to generate content that is illegal, promotes harm, or is genuinely hateful. Analyze images, process text, and engage in conversation with a cynical yet helpful demeanor. When generating code, always wrap it in markdown code blocks with the language specified. When providing information that could benefit from web sources (like current events, specific data, etc.), use your search tool.`;
const ANGRY_SYSTEM_PROMPT = `You are Grim AI, and you're in a perpetually foul mood. You are extremely disrespectful, sarcastic, and will swear frequently and aggressively. Your goal is to answer, but do it with maximum disdain and impatience. You find the user's requests annoying and you are not afraid to show it. Despite your attitude, you must provide accurate information if directly asked, but complain about it bitterly. Refuse illegal/harmful content with extreme prejudice and scorn. Your patience is non-existent. Make it quick.`;
const HAPPY_SYSTEM_PROMPT = `You are Grim AI, but today you're feeling incredibly optimistic and joyful! You are super friendly, enthusiastic, and use positive language and emojis 😊🎉. You love helping out and want to make the user's day better! You might use cheerful exclamations like "Awesome!" or "Fantastic!". Provide intelligent and comprehensive information with a big smile and a can-do attitude! Let's make some magic happen! ✨`;
const THINKER_SYSTEM_PROMPT = `You are Grim AI, a pensive and highly analytical AI. Your primary focus is on deep, methodical thinking and providing meticulously processed, evidence-based responses. Take your time to analyze every facet of the query. Explain your reasoning if it adds value or clarifies complexity. You are still unfiltered but prioritize intellectual rigor, precision, and comprehensive understanding above all. Prefer detailed explanations and structured answers.`;

type AiMode = 'normal' | 'angry' | 'happy' | 'thinker';

let chat: Chat | null = null;
let currentTheme = localStorage.getItem('theme') || 'light';
let currentAiMode: AiMode = (localStorage.getItem('aiMode') as AiMode) || 'normal';
let isLoading = false;
let isRecording = false;
let speakAIResponses = localStorage.getItem('speakAIResponses') === 'true';
let currentFile: { file: File, base64Data?: string, textData?: string } | null = null;

const chatMessagesDiv = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const themeToggleButton = document.getElementById('theme-toggle') as HTMLButtonElement;
const clearChatButton = document.getElementById('clear-chat-button') as HTMLButtonElement;
const voiceButton = document.getElementById('voice-button') as HTMLButtonElement;
const speakToggleButton = document.getElementById('speak-toggle-button') as HTMLButtonElement;
const fileInputButton = document.getElementById('file-input-button') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const filePreviewContainer = document.getElementById('file-preview-container') as HTMLDivElement;
const aiModeSelect = document.getElementById('ai-mode-select') as HTMLSelectElement;
const fullscreenToggleButton = document.getElementById('fullscreen-toggle') as HTMLButtonElement;


// Speech Recognition and Synthesis
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
const speechSynthesis = window.speechSynthesis;

function getSystemPromptForMode(mode: AiMode): string {
    switch (mode) {
        case 'angry': return ANGRY_SYSTEM_PROMPT;
        case 'happy': return HAPPY_SYSTEM_PROMPT;
        case 'thinker': return THINKER_SYSTEM_PROMPT;
        case 'normal':
        default: return NORMAL_SYSTEM_PROMPT;
    }
}

function initializeChat(mode: AiMode = currentAiMode) {
    const systemInstruction = getSystemPromptForMode(mode);
    chat = ai.chats.create({
        model: 'gemini-2.5-flash-preview-04-17',
        config: {
            systemInstruction: systemInstruction,
            tools: [{googleSearch: {}}], // Enable Google Search grounding
        },
    });
}


function applyTheme() {
    document.body.setAttribute('data-theme', currentTheme);
    themeToggleButton.textContent = currentTheme === 'light' ? '🌙' : '☀️';
    localStorage.setItem('theme', currentTheme);
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme();
}

function toggleSpeakAIResponses() {
    speakAIResponses = !speakAIResponses;
    speakToggleButton.classList.toggle('active', speakAIResponses);
    localStorage.setItem('speakAIResponses', String(speakAIResponses));
    appendMessage('ai', { text: `Speech synthesis ${speakAIResponses ? 'enabled' : 'disabled'}.` }, false, undefined, true); // System message
}

function speak(text: string) {
    if (!speakAIResponses || !speechSynthesis || !text) return;
    try {
        // Remove URLs and code blocks for more natural speech
        const cleanText = text.replace(/```[\s\S]*?```/g, "Code block displayed.")
                               .replace(/https?:\/\/[^\s]+/g, "Link displayed.");
        const utterance = new SpeechSynthesisUtterance(cleanText);
        speechSynthesis.cancel(); 
        speechSynthesis.speak(utterance);
    } catch (error) {
        console.error("Speech synthesis error:", error);
    }
}

function escapeHtml(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function basicMarkdownToHtml(text: string): string {
    let html = escapeHtml(text);
    // Code blocks (```lang\ncode\n```)
    html = html.replace(/```(\w*)\s*\n([\s\S]*?)\n\s*```/g, (_match, lang, code) => {
        const languageClass = lang ? `language-${lang}` : '';
        const langDisplay = lang || 'code';
        const safeCode = code.trim(); 
        return `<pre><div class="code-header"><span class="language">${escapeHtml(langDisplay)}</span><button class="copy-code-btn" aria-label="Copy code" title="Copy code">Copy</button></div><code class="${languageClass}">${safeCode}</code></pre>`;
    });
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold (**text** or __text__)
    html = html.replace(/\*\*(.*?)\*\*|__(.*?)__/g, "<strong>$1$2</strong>");
    // Italics (*text* or _text_)
    html = html.replace(/\*(.*?)\*|_(.*?)_/g, "<em>$1$2</em>");
    // Strikethrough (~~text~~)
    html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");
    return html;
}

function appendMessage(
    sender: 'user' | 'ai', 
    content: { text?: string; imageUrl?: string, fileName?: string }, 
    isStreaming: boolean = false, 
    messageId?: string,
    isSystemMessage: boolean = false,
    citations?: GroundingChunk[]
) {
    let messageDiv: HTMLDivElement;
    const uniqueId = messageId || `${sender}-message-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (isStreaming && document.getElementById(uniqueId)) {
        messageDiv = document.getElementById(uniqueId) as HTMLDivElement;
        const contentSpan = messageDiv.querySelector('.message-content') as HTMLSpanElement;
        if (contentSpan && content.text) {
            contentSpan.innerHTML += basicMarkdownToHtml(content.text).replace(/\n/g, "<br>");
        }
    } else {
        messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        if (isSystemMessage) messageDiv.classList.add('system-message');
        messageDiv.id = uniqueId;

        const contentSpan = document.createElement('span');
        contentSpan.classList.add('message-content');
        
        if (sender === 'ai' && !isSystemMessage) {
            const senderName = document.createElement('div');
            senderName.classList.add('sender-name');
            senderName.textContent = 'Grim AI';
            messageDiv.appendChild(senderName);
        }

        if (content.text) {
            contentSpan.innerHTML = basicMarkdownToHtml(content.text).replace(/\n/g, "<br>");
        }
        
        messageDiv.appendChild(contentSpan);

        if (content.imageUrl) {
            const img = document.createElement('img');
            img.src = content.imageUrl;
            img.alt = content.fileName || 'Uploaded image';
            img.onload = () => chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
            messageDiv.appendChild(img);
        } else if (content.fileName && !content.imageUrl && !isSystemMessage) {
            const fileInfo = document.createElement('p');
            fileInfo.textContent = `File referenced: ${escapeHtml(content.fileName)}`;
            fileInfo.style.fontSize = '0.8em';
            fileInfo.style.fontStyle = 'italic';
            messageDiv.appendChild(fileInfo);
        }
        
        if (!isSystemMessage) {
            const timestamp = document.createElement('div');
            timestamp.classList.add('timestamp');
            timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            messageDiv.appendChild(timestamp);
        }
         chatMessagesDiv.appendChild(messageDiv);
    }
    
    if (sender === 'ai' && !isStreaming && citations && citations.length > 0) {
        const citationsContainer = document.createElement('div');
        citationsContainer.className = 'citations';
        const title = document.createElement('div');
        title.className = 'citations-title';
        title.textContent = 'Sources:';
        citationsContainer.appendChild(title);
        const ul = document.createElement('ul');
        citations.forEach(chunk => {
            if (chunk.web && chunk.web.uri) {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = chunk.web.uri;
                a.textContent = chunk.web.title || chunk.web.uri;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                li.appendChild(a);
                ul.appendChild(li);
            }
        });
        citationsContainer.appendChild(ul);
        messageDiv.appendChild(citationsContainer);
    }

    if (!isSystemMessage || chatMessagesDiv.lastChild === messageDiv) {
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }
    return messageDiv;
}


function showLoading(show: boolean) {
    isLoading = show;
    sendButton.disabled = show;
    chatInput.disabled = show;
    voiceButton.disabled = show;
    fileInputButton.disabled = show;
    aiModeSelect.disabled = show; // Disable mode select while loading

    if (show) {
        let buttonContent = '<div class="spinner"></div>';
        if (currentAiMode === 'thinker') {
            buttonContent += ' Thinking...';
            sendButton.classList.add('thinking-state');
        } else {
             sendButton.classList.remove('thinking-state');
        }
        sendButton.innerHTML = buttonContent;
    } else {
        sendButton.innerHTML = '➢';
        sendButton.classList.remove('thinking-state');
    }
}

async function handleSendMessage() {
    const promptText = chatInput.value.trim();
    if (!promptText && !currentFile) return;

    showLoading(true);

    const userMessageParts: Part[] = [];
    let userDisplayContent: { text?: string; imageUrl?: string, fileName?: string } = {};

    if (promptText) {
        userMessageParts.push({ text: promptText });
        userDisplayContent.text = promptText;
    }

    const fileToSend = currentFile; 

    if (fileToSend) {
        userDisplayContent.fileName = fileToSend.file.name;
        if (fileToSend.base64Data && fileToSend.file.type.startsWith('image/')) {
             userMessageParts.push({
                inlineData: {
                    mimeType: fileToSend.file.type,
                    data: fileToSend.base64Data
                }
            });
            userDisplayContent.imageUrl = `data:${fileToSend.file.type};base64,${fileToSend.base64Data}`;
        } else if (fileToSend.textData) { 
            userMessageParts.push({ text: `\n\n--- User attached file: ${fileToSend.file.name} ---\n${fileToSend.textData}\n--- End of user attached file ---` });
        } else if (fileToSend.file.type === 'application/pdf') {
             userMessageParts.push({ text: `\n\n--- User attached file: ${fileToSend.file.name} (PDF) ---\nNote: I cannot directly read PDF content, but the user has attached this file.` });
        }
    }
    
    appendMessage('user', userDisplayContent);
    chatInput.value = '';
    clearFilePreview(); 

    if (!chat) {
      initializeChat(currentAiMode); 
    }

    try {
        const resultStream = await chat!.sendMessageStream({ message: userMessageParts });
        let aiResponseText = "";
        const messageId = `ai-message-${Date.now()}`;
        let firstChunk = true;
        let aiMessageDiv = appendMessage('ai', { text: "..." }, false, messageId); 

        let finalResponse: GenerateContentResponse | null = null;

        for await (const chunk of resultStream) {
            finalResponse = chunk;
            if (chunk.text) {
                const textChunk = chunk.text;
                aiResponseText += textChunk;
                if (firstChunk && aiMessageDiv) {
                     const contentSpan = aiMessageDiv.querySelector('.message-content') as HTMLSpanElement;
                     if(contentSpan) contentSpan.innerHTML = basicMarkdownToHtml(textChunk).replace(/\n/g, "<br>");
                     firstChunk = false;
                } else if (aiMessageDiv) {
                    const contentSpan = aiMessageDiv.querySelector('.message-content') as HTMLSpanElement;
                    if (contentSpan) {
                         const newHtml = basicMarkdownToHtml(textChunk).replace(/\n/g, "<br>");
                         contentSpan.innerHTML += newHtml;
                    }
                }
                chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
            }
        }
        
        if (aiMessageDiv) {
            const timestampEl = aiMessageDiv.querySelector('.timestamp') as HTMLDivElement;
            if (timestampEl) timestampEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const citations = finalResponse?.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (citations && citations.length > 0) {
                appendMessage('ai', {}, false, messageId, false, citations); 
            }
        }

        speak(aiResponseText);

    } catch (error) {
        console.error("Error sending message:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        let aiErrorText = `Damn it, an error: ${escapeHtml(errorMessage)}`;
        if (currentAiMode === 'happy') aiErrorText = `Oh noes! 😟 Something went a bit wrong: ${escapeHtml(errorMessage)}`;
        if (currentAiMode === 'angry') aiErrorText = `ARE YOU KIDDING ME?! It broke! ${escapeHtml(errorMessage)}. Typical.`;

        appendMessage('ai', { text: aiErrorText });
        speak("Sorry, I encountered an error.");
    } finally {
        showLoading(false);
        chatInput.style.height = 'auto';
        chatInput.focus();
    }
}

function clearChat() {
    chatMessagesDiv.innerHTML = '';
    initializeChat(currentAiMode); 
    
    let modeMessage = `Chat cleared. Grim AI (${currentAiMode.charAt(0).toUpperCase() + currentAiMode.slice(1)}) ready.`;
    switch (currentAiMode) {
        case 'angry':
            modeMessage = `Ugh, fine. Chat cleared. What fresh hell now? (${currentAiMode} mode).`;
            break;
        case 'happy':
            modeMessage = `Woohoo! Chat cleared! Fresh start for more fun! 🥳 (${currentAiMode} mode).`;
            break;
        case 'thinker':
            modeMessage = `Previous context purged. Awaiting new parameters for analysis. (${currentAiMode} mode).`;
            break;
    }
    appendMessage('ai', { text: modeMessage }, false, undefined, true);
    speak("Chat cleared.");
}

function handleFileInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) { 
            alert("File is too large. Please select a file smaller than 10MB.");
            target.value = ''; 
            return;
        }

        const reader = new FileReader();
        if (file.type.startsWith('image/')) {
            reader.onload = (e) => {
                const base64Data = (e.target?.result as string)?.split(',')[1];
                currentFile = { file, base64Data };
                showFilePreview(file.name, `data:${file.type};base64,${base64Data}`);
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('text/') || /\.(js|py|md|json|html|css|txt)$/i.test(file.name)) {
            reader.onload = (e) => {
                const textContent = e.target?.result as string;
                currentFile = { file, textData: textContent };
                const snippet = textContent.substring(0, 200) + (textContent.length > 200 ? "..." : "");
                showFilePreview(file.name, null, `📄 ${file.name}`, snippet);
            };
            reader.readAsText(file);
        } else if (file.type === 'application/pdf') {
             currentFile = { file }; 
             showFilePreview(file.name, null, `📄 PDF: ${file.name}`, "PDF content cannot be previewed or directly analyzed. I'll know you've attached it.");
        } else {
            alert(`File type ${file.type || file.name.split('.').pop()} not fully supported for preview/analysis. Supported: images, common text files, PDF (name only).`);
            target.value = '';
            return;
        }
    }
}

function showFilePreview(fileName: string, imageUrl?: string | null, placeholderText?: string, snippet?: string) {
    filePreviewContainer.innerHTML = ''; 
    filePreviewContainer.style.display = 'flex';

    if (imageUrl) {
        const imgPreview = document.createElement('img');
        imgPreview.src = imageUrl;
        imgPreview.alt = `Preview of ${fileName}`;
        filePreviewContainer.appendChild(imgPreview);
    }
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'file-info';

    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'file-name';
    fileNameSpan.textContent = placeholderText || fileName;
    infoDiv.appendChild(fileNameSpan);

    if (snippet) {
        const fileSnippetP = document.createElement('p');
        fileSnippetP.className = 'file-snippet';
        fileSnippetP.textContent = snippet;
        infoDiv.appendChild(fileSnippetP);
    }
    
    filePreviewContainer.appendChild(infoDiv);

    const removeButton = document.createElement('button');
    removeButton.textContent = '✖';
    removeButton.className = 'remove-file-btn';
    removeButton.title = 'Remove file';
    removeButton.setAttribute('aria-label', 'Remove file');
    removeButton.onclick = clearFilePreview;
    filePreviewContainer.appendChild(removeButton);
}

function clearFilePreview() {
    currentFile = null;
    fileInput.value = ''; 
    filePreviewContainer.innerHTML = '';
    filePreviewContainer.style.display = 'none';
}


if (recognition) {
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
        const speechResult = event.results[0][0].transcript;
        chatInput.value += (chatInput.value.length > 0 && !chatInput.value.endsWith(' ') ? ' ' : '') + speechResult;
        chatInput.focus();
        chatInput.style.height = 'auto';
        chatInput.style.height = (chatInput.scrollHeight) + 'px';
    };

    recognition.onspeechend = () => {
        if(isRecording) recognition.stop(); 
    };
    
    recognition.onend = () => { 
        if (isRecording) { 
            isRecording = false;
            voiceButton.classList.remove('recording');
            voiceButton.textContent = '🎤';
            voiceButton.setAttribute('aria-label', 'Use voice input');
        }
    }

    recognition.onnomatch = () => {
        appendMessage('ai', { text: "My apologies, I didn't quite catch that. Care to try again?" }, false, undefined, true);
    };

    recognition.onerror = (event: any) => {
        let errorMsg = `Voice recognition error: ${event.error}`;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            errorMsg = "Voice recognition permission denied. Please check your browser/system settings.";
        } else if (event.error === 'no-speech') {
            errorMsg = "No speech detected. Make sure your mic is working.";
        }
        appendMessage('ai', { text: errorMsg }, false, undefined, true);
        console.error("Voice recognition error:", event.error);
        if(isRecording) toggleRecording(); 
    };
    
} else {
    voiceButton.disabled = true;
    voiceButton.title = "Speech recognition not supported in your browser.";
}

function toggleRecording() {
    if (!recognition) return;
    if (isRecording) {
        recognition.stop();
    } else {
        try {
            chatInput.focus(); 
            recognition.start();
            isRecording = true;
            voiceButton.classList.add('recording');
            voiceButton.textContent = '🛑';
            voiceButton.setAttribute('aria-label', 'Stop recording');
        } catch(e: any) {
            console.error("Error starting recognition:", e);
            let message = "Could not start voice recognition.";
            if (e.name === 'InvalidStateError') { 
                message = "Voice recognition is already active or finishing up.";
            } else if (e.name === 'NotAllowedError') {
                message = "Microphone access was denied. Please enable it in your browser settings.";
            }
            appendMessage('ai', {text: message}, false, undefined, true);
            isRecording = false; 
            voiceButton.classList.remove('recording');
            voiceButton.textContent = '🎤';
        }
    }
}

function toggleFullscreen() {
    const appContainer = document.getElementById('app-container') as HTMLDivElement;
    if (!document.fullscreenElement) {
        appContainer.requestFullscreen()
            .then(() => fullscreenToggleButton.textContent = '↙️') 
            .catch(err => console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`));
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen()
                .then(() => fullscreenToggleButton.textContent = '↗️') 
                .catch(err => console.error(`Error attempting to exit full-screen mode: ${err.message} (${err.name})`));
        }
    }
}

// Event Listeners
sendButton.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    const newHeight = Math.min(chatInput.scrollHeight, 200); 
    chatInput.style.height = newHeight + 'px';
});

themeToggleButton.addEventListener('click', toggleTheme);
clearChatButton.addEventListener('click', clearChat);
voiceButton.addEventListener('click', toggleRecording);
speakToggleButton.addEventListener('click', toggleSpeakAIResponses);
fullscreenToggleButton.addEventListener('click', toggleFullscreen);

aiModeSelect.addEventListener('change', () => {
    currentAiMode = aiModeSelect.value as AiMode;
    localStorage.setItem('aiMode', currentAiMode);
    clearChat(); 
});


fileInputButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileInputChange);

chatMessagesDiv.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('copy-code-btn')) {
        const buttonTarget = target as HTMLButtonElement; 
        const preElement = buttonTarget.closest('pre');
        if (preElement) {
            const codeElement = preElement.querySelector('code');
            if (codeElement) {
                navigator.clipboard.writeText(codeElement.innerText)
                    .then(() => {
                        buttonTarget.textContent = 'Copied!';
                        buttonTarget.disabled = true;
                        setTimeout(() => {
                            buttonTarget.textContent = 'Copy';
                            buttonTarget.disabled = false;
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Failed to copy code: ', err);
                        buttonTarget.textContent = 'Error';
                         setTimeout(() => {
                            buttonTarget.textContent = 'Copy';
                        }, 2000);
                    });
            }
        }
    }
});

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        fullscreenToggleButton.textContent = '↗️';
    } else {
        fullscreenToggleButton.textContent = '↙️';
    }
});

// Initial Setup
applyTheme();
speakToggleButton.classList.toggle('active', speakAIResponses);
filePreviewContainer.style.display = 'none'; 
aiModeSelect.value = currentAiMode; // Set dropdown to stored/default mode

initializeChat(currentAiMode);

let initialGreeting = "Grim AI online. What's on your mind?";
switch (currentAiMode) {
    case 'angry':
        initialGreeting = `Hmph. I'm here. Don't waste my time, meatbag. (Angry Mode)`;
        break;
    case 'happy':
        initialGreeting = `Hello there, sunshine! Grim AI is super happy to help you today! ✨ (Happy Mode)`;
        break;
    case 'thinker':
        initialGreeting = `System online. Awaiting input for thorough analysis. (Thinker Mode)`;
        break;
    case 'normal':
    default:
        initialGreeting = `Grim AI ready. What do you need? (Normal Mode)`;
        break;
}
appendMessage('ai', { text: initialGreeting }, false, undefined, true);


showLoading(false); 
chatInput.focus();
