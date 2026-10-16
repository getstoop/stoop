import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { instanceClient } from "./api/clients";
import { fetchVersion } from "./api/server";

// The smoke test (STOOP-501): one line from a plain fetch of GET /version,
// one from InstanceService.GetInstanceStatus through the generated client.
// Either failing shows its error text in place of the result.

type Line =
  | { state: "loading" }
  | { state: "ok"; text: string }
  | { state: "failed"; text: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [version, setVersion] = useState<Line>({ state: "loading" });
  const [status, setStatus] = useState<Line>({ state: "loading" });

  useEffect(() => {
    fetchVersion()
      .then((server) =>
        setVersion({
          state: "ok",
          text: `${server.name} ${server.version} (bridge ${server.bridge})`,
        }),
      )
      .catch((error: unknown) =>
        setVersion({ state: "failed", text: errorText(error) }),
      );

    // instanceClient() throws when the server address is missing, so it is
    // called inside the promise chain to land in the same catch.
    Promise.resolve()
      .then(() => instanceClient().getInstanceStatus({}))
      .then((response) =>
        setStatus({
          state: "ok",
          text: [
            `needs_setup: ${response.needsSetup}`,
            `public URL: ${response.publicUrl || "(not set)"}`,
            `name: ${response.instanceName || "(not set)"}`,
          ].join("\n"),
        }),
      )
      .catch((error: unknown) =>
        setStatus({ state: "failed", text: errorText(error) }),
      );
  }, []);

  return (
    <View style={styles.screen}>
      <StatusLine label="GET /version" line={version} />
      <StatusLine label="GetInstanceStatus" line={status} />
      <StatusBar style="auto" />
    </View>
  );
}

function StatusLine({ label, line }: { label: string; line: Line }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      {line.state === "loading" && <Text style={styles.value}>…</Text>}
      {line.state === "ok" && <Text style={styles.value}>{line.text}</Text>}
      {line.state === "failed" && (
        <Text style={[styles.value, styles.failed]} accessibilityRole="alert">
          {line.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 24,
  },
  line: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  value: {
    fontSize: 16,
    color: "#111",
  },
  failed: {
    color: "#b00020",
  },
});
