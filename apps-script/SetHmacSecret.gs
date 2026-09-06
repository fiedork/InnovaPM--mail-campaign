// Pomocnicza funkcja do ustawienia HMAC_SECRET w Script Properties zgodnie z APPS_SCRIPT_HMAC_SECRET (Netlify).
// Uruchamiana przez: clasp run setHmacSecretFromValue --params '["<secret>"]'
function setHmacSecretFromValue(secret) {
  if (!secret || typeof secret !== "string" || secret.length < 16) {
    throw new Error("Nieprawidłowy sekret przekazany do funkcji.");
  }
  const props = PropertiesService.getScriptProperties();
  const previous = props.getProperty("HMAC_SECRET");
  props.setProperty("HMAC_SECRET", secret);
  const current = props.getProperty("HMAC_SECRET");
  return {
    updated: current === secret,
    previousLength: previous ? previous.length : 0,
    currentLength: current ? current.length : 0,
  };
}
