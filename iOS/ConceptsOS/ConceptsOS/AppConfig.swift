// Compile-time app configuration. Values here are safe to publish
// (they're either the anon-key half of a public/anon pair or public
// hostnames). Never put service_role keys or admin API keys in this
// file.

import Foundation

enum AppConfig {
    /// Public Supabase URL, e.g. https://emkhiqufwtevsiworiqv.supabase.co
    static let supabaseURL = "https://emkhiqufwtevsiworiqv.supabase.co"

    /// Public anon key. This is the JWT-signed anon role — it can only
    /// do what RLS allows anonymous users to do.
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVta2hpcXVmd3RldnNpd29yaXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMzE3NjUsImV4cCI6MjEwMTkwNzc2NX0.nuzCTH9Q2BtB5hCgIIAzSXLUISzUMqfDqxZ6apuyOi4"

    /// ConceptsOS provisioning API. Public HTTPS.
    static let apiBaseURL = "https://api.conceptsos.com"

    /// Where the per-user pod is reachable after the WireGuard tunnel
    /// is up. Same address for every user; the gateway routes by peer
    /// pubkey.
    static let podURL = "http://10.10.0.1:3000"
}
