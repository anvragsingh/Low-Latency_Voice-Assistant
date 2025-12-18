import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Radio, Activity, Zap, Server, Terminal, Volume2, WifiOff, Wifi } from 'lucide-react';

const VoiceAssistant = () => {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('disconnected');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [latencyMetrics, setLatencyMetrics] = useState({ asr: 0, ttft: 0 });
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // --- WEBSOCKET CONNECTION ---
  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      const wsUrl = 'ws://localhost:8000/ws/audio';
      console.log('Connecting to:', wsUrl);
      
      try {
        socketRef.current = new WebSocket(wsUrl);

        socketRef.current.onopen = () => {
          if (!mounted) return;
          setStatus('idle');
          setError(null);
          setConnectionAttempts(0);
          console.log('✓ Connected to backend');
        };

        socketRef.current.onmessage = (event) => {
          if (!mounted) return;
          
          try {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
              case 'status':
                setStatus(data.message);
                break;
              
              case 'transcript':
                setTranscript(data.text);
                setResponse('');
                if (data.latency) {
                  setLatencyMetrics(prev => ({ ...prev, asr: Math.round(data.latency) }));
                }
                break;
              
              case 'latency_stats':
                setLatencyMetrics({
                  asr: Math.round(data.asr),
                  ttft: Math.round(data.ttft)
                });
                break;
              
              case 'token':
                setResponse(prev => prev + data.text);
                break;
              
              case 'error':
                setError(data.message);
                console.error('Backend error:', data.message);
                break;
            }
          } catch (err) {
            console.error('Error parsing message:', err);
          }
        };

        socketRef.current.onerror = (err) => {
          console.error('WebSocket error:', err);
          setError('Connection error. Make sure backend is running on port 8000.');
        };

        socketRef.current.onclose = () => {
          if (!mounted) return;
          
          setStatus('disconnected');
          console.log('✗ Disconnected from backend');
          
          // Auto-reconnect with exponential backoff
          setConnectionAttempts(prev => {
            const attempts = prev + 1;
            const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
            console.log(`Reconnecting in ${delay}ms... (attempt ${attempts})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mounted) connect();
            }, delay);
            
            return attempts;
          });
        };
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
        setError('Failed to create connection. Check backend server.');
      }
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // --- AUDIO RECORDING ---
  const startRecording = async () => {
    try {
      if (status === 'disconnected') {
        setError('Cannot record: Not connected to backend. Please wait for connection.');
        return;
      }

      setIsListening(true);
      setTranscript('');
      setResponse('');
      setError(null);

      // Create AudioContext with 16kHz sample rate (Whisper requirement)
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Use ScriptProcessor for audio processing
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (e) => {
        if (!isListening) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate audio level for visualization
        const sum = inputData.reduce((a, b) => a + Math.abs(b), 0);
        const avgLevel = sum / inputData.length;
        setAudioLevel(Math.min(100, avgLevel * 100 * 3));

        // Send audio to backend if connected
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          // Convert Float32 (-1 to 1) to Int16 (-32768 to 32767)
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          try {
            socketRef.current.send(pcmData.buffer);
          } catch (err) {
            console.error('Error sending audio:', err);
          }
        }
      };

      console.log('✓ Recording started');
    } catch (err) {
      console.error('Microphone error:', err);
      setError(`Microphone error: ${err.message}`);
      setIsListening(false);
    }
  };

  const stopRecording = () => {
    console.log('✓ Recording stopped');
    setIsListening(false);
    setAudioLevel(0);
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const getStatusConfig = () => {
    switch(status) {
      case 'disconnected':
        return { 
          color: 'red', 
          bg: 'bg-red-900/20', 
          border: 'border-red-900', 
          text: 'text-red-400',
          glow: 'bg-red-500'
        };
      case 'listening':
        return { 
          color: 'green', 
          bg: 'bg-green-900/20', 
          border: 'border-green-900', 
          text: 'text-green-400',
          glow: 'bg-green-500'
        };
      case 'processing':
        return { 
          color: 'yellow', 
          bg: 'bg-yellow-900/20', 
          border: 'border-yellow-900', 
          text: 'text-yellow-400',
          glow: 'bg-yellow-500'
        };
      default:
        return { 
          color: 'blue', 
          bg: 'bg-slate-800', 
          border: 'border-slate-700', 
          text: 'text-slate-400',
          glow: 'bg-blue-500'
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            Low-Latency Voice Assistant
          </h1>
          <div className="flex justify-center items-center gap-4 text-sm">
            {/* <span className="flex items-center gap-2 text-gray-400">
              <Server className="w-4 h-4"/>
              Python Backend
            </span>
            <span className="flex items-center gap-2 text-gray-400">
              <Zap className="w-4 h-4"/>
              WebSocket Stream
            </span> */}
            <span className={`flex items-center gap-2 ${status === 'disconnected' ? 'text-red-400' : 'text-green-400'}`}>
              {status === 'disconnected' ? <WifiOff className="w-4 h-4"/> : <Wifi className="w-4 h-4"/>}
              {status === 'disconnected' ? 'Offline' : 'Connected'}
            </span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-900 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="text-red-400 mt-0.5">⚠️</div>
              <div className="flex-1">
                <div className="font-semibold text-red-300 mb-1">Error</div>
                <div className="text-sm text-red-200">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Main Control */}
        <div className="relative flex justify-center py-12">
          {/* Glow effect */}
          <div className={`absolute inset-0 rounded-full blur-3xl opacity-20 transition-colors duration-500 ${statusConfig.glow}`}></div>
          
          {/* Microphone button */}
          <button
            onClick={isListening ? stopRecording : startRecording}
            disabled={status === 'disconnected'}
            className={`relative w-40 h-40 rounded-full flex items-center justify-center border-4 transition-all duration-300 shadow-2xl z-10 ${
              status === 'disconnected' 
                ? 'border-gray-700 bg-gray-800 cursor-not-allowed opacity-50'
                : isListening 
                  ? 'border-red-500 bg-red-500/10 hover:bg-red-500/20' 
                  : 'border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700'
            }`}
          >
            {isListening ? (
              <MicOff className="w-12 h-12 text-red-500"/>
            ) : (
              <Mic className="w-12 h-12 text-slate-400"/>
            )}
          </button>
          
          {/* Audio level visualization */}
          {isListening && (
            <>
              <div 
                className="absolute w-40 h-40 rounded-full border-2 border-green-500/30 transition-all duration-75 pointer-events-none"
                style={{ transform: `scale(${1 + audioLevel / 80})` }}
              />
              <div 
                className="absolute w-40 h-40 rounded-full border border-green-500/20 transition-all duration-100"
                style={{ transform: `scale(${1 + audioLevel / 60})` }}
              />
            </>
          )}
        </div>

        {/* Status Badge */}
        <div className="flex justify-center">
          <span className={`px-6 py-2 rounded-full text-sm font-mono uppercase tracking-wider border ${statusConfig.border} ${statusConfig.bg} ${statusConfig.text}`}>
            {status}
            {status === 'disconnected' && connectionAttempts > 0 && ` (${connectionAttempts})`}
          </span>
        </div>

        {/* Latency Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800/50 backdrop-blur rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400"/>
              <span className="text-xs text-slate-400 uppercase font-semibold">ASR Latency</span>
            </div>
            <div className={`text-3xl font-mono font-bold ${
              latencyMetrics.asr === 0 ? 'text-slate-600' :
              latencyMetrics.asr < 100 ? 'text-green-400' :
              latencyMetrics.asr < 300 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {latencyMetrics.asr} ms
            </div>
          </div>
          
          <div className="bg-slate-800/50 backdrop-blur rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-purple-400"/>
              <span className="text-xs text-slate-400 uppercase font-semibold">TTFT</span>
            </div>
            <div className={`text-3xl font-mono font-bold ${
              latencyMetrics.ttft === 0 ? 'text-slate-600' :
              latencyMetrics.ttft < 100 ? 'text-green-400' :
              latencyMetrics.ttft < 200 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {latencyMetrics.ttft} ms
            </div>
          </div>
        </div>

        {/* Conversation Display */}
        <div className="grid gap-4">
          <div className="bg-slate-800/50 backdrop-blur rounded-xl p-5 border border-slate-700 min-h-[100px]">
            <div className="flex items-center gap-2 mb-3">
              <Mic className="w-4 h-4 text-blue-400"/>
              <span className="text-xs text-slate-400 uppercase font-bold">You Said</span>
            </div>
            <p className="text-lg leading-relaxed">
              {transcript || <span className="text-slate-600 italic">Speak after clicking the microphone...</span>}
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-xl p-5 border border-slate-700 min-h-[100px]">
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="w-4 h-4 text-cyan-400"/>
              <span className="text-xs text-slate-400 uppercase font-bold">Assistant Response</span>
            </div>
            <p className="text-lg text-cyan-100 leading-relaxed">
              {response || <span className="text-slate-600 italic">Waiting for your input...</span>}
            </p>
          </div>
        </div>

        {/* Instructions */}
        {/* <div className="bg-blue-900/10 border border-blue-800/30 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-blue-300 mb-3">💡 How to Use</h3>
          <ol className="space-y-2 text-sm text-blue-200/80">
            <li>1. Make sure the Python backend is running on port 8000</li>
            <li>2. Click the microphone button to start recording</li>
            <li>3. Speak your query clearly</li>
            <li>4. Stop speaking and wait ~1.5s for processing</li>
            <li>5. View real-time latency metrics and response</li>
          </ol>
        </div> */}
      </div>
    </div>
  );
};

export default VoiceAssistant;
