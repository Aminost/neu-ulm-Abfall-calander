import { Component, type ReactNode } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Class-based React error boundary (functional components cannot catch errors).
 * Wraps the root layout so any unhandled render error shows a recovery screen
 * instead of a blank white crash.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#f9fafb",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text style={{ fontSize: 48, marginBottom: 16 }}>⚠️</Text>
        <Text
          style={{
            fontSize: 20,
            fontWeight: "700",
            color: "#111827",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Ein Fehler ist aufgetreten
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "#6b7280",
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Die App konnte nicht geladen werden. Bitte versuche es erneut.
        </Text>

        {this.state.error && (
          <ScrollView
            style={{
              maxHeight: 120,
              backgroundColor: "#fef2f2",
              borderRadius: 8,
              padding: 12,
              marginBottom: 24,
              width: "100%",
            }}
          >
            <Text style={{ fontSize: 12, color: "#dc2626", fontFamily: "monospace" }}>
              {this.state.error.message}
            </Text>
          </ScrollView>
        )}

        <TouchableOpacity
          onPress={this.handleReload}
          style={{
            backgroundColor: "#10b981",
            paddingHorizontal: 32,
            paddingVertical: 14,
            borderRadius: 100,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
            Neu starten
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}
