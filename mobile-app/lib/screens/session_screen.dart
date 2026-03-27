import 'package:flutter/material.dart';
import '../services/bridge_service.dart';

class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key});

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  final _bridge = BridgeService.instance;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Connected'),
        actions: [
          IconButton(
            icon: const Icon(Icons.close),
            onPressed: () {
              _bridge.disconnect();
              Navigator.pushReplacementNamed(context, '/');
            },
          ),
        ],
      ),
      body: StreamBuilder<BridgeMessage>(
        stream: _bridge.messages,
        builder: (context, snapshot) {
          return Column(
            children: [
              // Connection status
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                color: Colors.green.withValues(alpha: 0.1),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Colors.green),
                    const SizedBox(width: 8),
                    Text(
                      'Connected to desktop',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ),
              // Messages list
              Expanded(
                child: _bridge.messageHistory.isEmpty
                    ? const Center(
                        child: Text(
                          'Waiting for messages from desktop...',
                          style: TextStyle(color: Colors.grey),
                        ),
                      )
                    : ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(16),
                        itemCount: _bridge.messageHistory.length,
                        itemBuilder: (context, index) {
                          final msg = _bridge.messageHistory[
                              _bridge.messageHistory.length - 1 - index];
                          return Card(
                            margin: const EdgeInsets.only(bottom: 8),
                            child: ListTile(
                              leading: Icon(_iconForType(msg.type)),
                              title: Text(msg.content),
                              subtitle: Text(
                                msg.timestamp.toLocal().toString().substring(0, 19),
                                style: const TextStyle(fontSize: 12),
                              ),
                            ),
                          );
                        },
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  IconData _iconForType(String type) {
    return switch (type) {
      'ping' => Icons.fiber_manual_record,
      'summary' => Icons.description,
      'update' => Icons.update,
      'chat' => Icons.chat,
      _ => Icons.message,
    };
  }
}
