import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BridgeMessage {
  final String type;
  final String content;
  final DateTime timestamp;

  BridgeMessage({
    required this.type,
    required this.content,
    required this.timestamp,
  });

  factory BridgeMessage.fromJson(Map<String, dynamic> json) {
    return BridgeMessage(
      type: json['type'] ?? 'unknown',
      content: json['content'] ?? json.toString(),
      timestamp: json['timestamp'] != null
          ? DateTime.parse(json['timestamp'])
          : DateTime.now(),
    );
  }
}

class BridgeService {
  static final BridgeService instance = BridgeService._();
  BridgeService._();

  WebSocketChannel? _channel;
  final _messageController = StreamController<BridgeMessage>.broadcast();
  final List<BridgeMessage> messageHistory = [];
  String? _sessionId;
  String? _baseUrl;

  Stream<BridgeMessage> get messages => _messageController.stream;
  bool get isConnected => _channel != null;

  Future<void> connect(String baseUrl, String sessionId) async {
    _baseUrl = baseUrl;
    _sessionId = sessionId;

    // Convert https:// to wss:// for WebSocket
    final wsUrl = baseUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
    final uri = Uri.parse('$wsUrl/api/ws?session=$sessionId&role=mobile');

    _channel = WebSocketChannel.connect(uri);
    await _channel!.ready;

    _channel!.stream.listen(
      (data) {
        final json = jsonDecode(data as String) as Map<String, dynamic>;
        final msg = BridgeMessage.fromJson(json);
        messageHistory.add(msg);
        _messageController.add(msg);
      },
      onDone: () => _handleDisconnect(),
      onError: (e) => _handleDisconnect(),
    );

    // Persist session for reconnection
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('session_id', sessionId);
    await prefs.setString('base_url', baseUrl);
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    _sessionId = null;
  }

  void _handleDisconnect() {
    _channel = null;
    // Could add auto-reconnect logic here
  }

  void send(Map<String, dynamic> data) {
    _channel?.sink.add(jsonEncode(data));
  }
}
