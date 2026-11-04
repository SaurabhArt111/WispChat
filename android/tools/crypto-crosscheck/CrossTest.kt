import com.pingo.app.crypto.E2ee
import java.io.File

fun main() {
    val m = File("web.txt").readLines().associate { it.substringBefore('\t') to it.substringAfter('\t') }
    fun need(k: String) = m[k] ?: error("missing $k")

    // --- A) Kotlin reads what the WEB wrote -------------------------------------------------
    val t0 = System.currentTimeMillis()
    val privB = E2ee.unwrapPrivateKeyWithPassword(need("pw"),
        E2ee.WrappedPrivateKey(need("wrapB_ct"), need("wrapB_iv"), need("wrapB_salt"), need("wrapB_it").toInt()))
    println("PBKDF2 210k iterations + unwrap: ${System.currentTimeMillis() - t0} ms")
    val pubA = E2ee.publicKeyFromJwk(need("Ax"), need("Ay"))
    val mkB = E2ee.unwrapMessageKey(need("kB_w"), need("kB_iv"), privB, pubA)          // recipient B opens it
    check(E2ee.decryptText(mkB, need("ct"), need("iv")) == need("text")) { "text mismatch" }
    check(E2ee.decryptBytes(mkB, E2ee.fromB64(need("bytes")), need("bytesIv")).joinToString() == "1, 2, 3, -6, -5, -4") { "bytes mismatch" }
    val privA = E2ee.unwrapPrivateKeyWithPassword(need("pw"),
        E2ee.WrappedPrivateKey(need("wrapA_ct"), need("wrapA_iv"), need("wrapA_salt"), need("wrapA_it").toInt()))
    val mkA = E2ee.unwrapMessageKey(need("kA_w"), need("kA_iv"), privA, pubA)          // sender A reads own copy
    check(E2ee.decryptText(mkA, need("ct"), need("iv")) == need("text"))
    try { E2ee.unwrapPrivateKeyWithPassword("wrong", E2ee.WrappedPrivateKey(need("wrapA_ct"), need("wrapA_iv"), need("wrapA_salt"), need("wrapA_it").toInt())); error("wrong password accepted") } catch (e: javax.crypto.AEADBadTagException) { }
    println("KOTLIN READS WEB OUTPUT: OK (${E2ee.decryptText(mkB, need("ct"), need("iv"))})")

    // --- B) Kotlin writes, WEB must read ----------------------------------------------------
    val kp = E2ee.generateIdentity()
    val pw = "kötlin-pässword"
    val wrap = E2ee.wrapPrivateKeyWithPassword(kp.private, kp.public, pw)
    val mk = E2ee.newMessageKey()
    val sealed = E2ee.encryptText(mk, "native → web ✓ 🚀")
    val env = E2ee.wrapMessageKey(mk, kp.private, kp.public, "me")
    val (bct, biv) = E2ee.encryptBytes(mk, byteArrayOf(9, 8, 7, -1, 0))
    val j = E2ee.publicJwk(kp.public)
    fun esc(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")
    File("kotlin.json").writeText("""{"pw":"$pw","pub":{"kty":"EC","crv":"P-256","x":"${j.x}","y":"${j.y}","ext":true,"key_ops":[]},
      "wrap":{"wrappedPrivateKey":"${wrap.wrappedPrivateKey}","wrapIv":"${wrap.wrapIv}","kdfSalt":"${wrap.kdfSalt}","kdfIterations":${wrap.kdfIterations}},
      "key":{"wrappedKey":"${env.wrappedKey}","keyIv":"${env.keyIv}"},"ct":"${sealed.ciphertextB64}","iv":"${sealed.ivB64}","text":"${esc("native → web ✓ 🚀")}",
      "bytes":"${E2ee.toB64(bct)}","bytesIv":"$biv"}""")
    println("kotlin.json written")
}
