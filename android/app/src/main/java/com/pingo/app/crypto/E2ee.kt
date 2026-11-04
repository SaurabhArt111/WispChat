package com.pingo.app.crypto

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wire-compatible port of the web app's end-to-end encryption (client/src/utils/crypto.js).
 * Same algorithms, same constants, same JSON shapes — so a message written on the web is readable
 * here and vice-versa:
 *
 *  - identity key: ECDH P-256 (public key travels as a JWK)
 *  - private key at rest on the server: AES-256-GCM, key = PBKDF2-HMAC-SHA256(password, salt, iterations)
 *  - per message: random AES-256 key "mk"; text is AES-GCM(mk); mk is wrapped once per participant with
 *    AES-GCM(HKDF-SHA256(ECDH(mine, theirs)))
 *
 * Pure JVM (no Android classes) so it can be unit-tested on a laptop.
 */
object E2ee {
    private val random = SecureRandom()
    private val HKDF_SALT = "wispchat-e2ee-v1".toByteArray(Charsets.UTF_8)
    private val HKDF_INFO = "wispchat-message-key-wrap".toByteArray(Charsets.UTF_8)
    const val DEFAULT_KDF_ITERATIONS = 210_000

    private val b64 = Base64.getEncoder()
    private val b64d = Base64.getDecoder()
    private val b64u = Base64.getUrlEncoder().withoutPadding()
    private val b64ud = Base64.getUrlDecoder()

    fun toB64(b: ByteArray): String = b64.encodeToString(b)
    fun fromB64(s: String): ByteArray = b64d.decode(s)

    // ---------------------------------------------------------------- EC keys / JWK
    private val ecParams: ECParameterSpec by lazy {
        val ap = AlgorithmParameters.getInstance("EC")
        ap.init(ECGenParameterSpec("secp256r1"))
        ap.getParameterSpec(ECParameterSpec::class.java)
    }

    /** A public key as the JWK fields the web client / server expect. */
    data class PublicJwk(val x: String, val y: String) {
        fun toMap(): Map<String, Any> =
            linkedMapOf("kty" to "EC", "crv" to "P-256", "x" to x, "y" to y, "ext" to true, "key_ops" to emptyList<String>())
    }

    fun generateIdentity(): KeyPair {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec("secp256r1"), random)
        return g.generateKeyPair()
    }

    private fun fixed32(v: BigInteger): ByteArray {
        val raw = v.toByteArray()
        val out = ByteArray(32)
        val src = if (raw.size > 32) raw.copyOfRange(raw.size - 32, raw.size) else raw
        System.arraycopy(src, 0, out, 32 - src.size, src.size)
        return out
    }

    fun publicJwk(pub: PublicKey): PublicJwk {
        val w = (pub as ECPublicKey).w
        return PublicJwk(b64u.encodeToString(fixed32(w.affineX)), b64u.encodeToString(fixed32(w.affineY)))
    }

    fun publicKeyFromJwk(x: String, y: String): PublicKey {
        val point = ECPoint(BigInteger(1, b64ud.decode(x)), BigInteger(1, b64ud.decode(y)))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, ecParams))
    }

    fun privateKeyFromJwk(d: String): PrivateKey =
        KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, b64ud.decode(d)), ecParams))

    /** The private scalar as base64url ("d" of the JWK) — what we keep in the device's secure storage. */
    fun privateD(priv: PrivateKey): String = b64u.encodeToString(fixed32((priv as ECPrivateKey).s))

    // The web client serialises JWKs with JSON.stringify; they only contain flat string/bool/array fields.
    private fun jsonString(json: String, key: String): String? =
        Regex("\"" + Regex.escape(key) + "\"\\s*:\\s*\"([^\"]*)\"").find(json)?.groupValues?.get(1)

    // ---------------------------------------------------------------- password wrapping of the private key
    private fun pbkdf2Sha256(password: String, salt: ByteArray, iterations: Int): ByteArray {
        // One 32-byte block == exactly one PBKDF2 output block. Done by hand so the password is
        // unambiguously UTF-8 encoded, exactly like the browser's TextEncoder.
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        mac.update(salt)
        mac.update(byteArrayOf(0, 0, 0, 1))
        var u = mac.doFinal()
        val t = u.copyOf()
        for (i in 1 until iterations) {
            u = mac.doFinal(u)
            for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
        }
        return t
    }

    data class WrappedPrivateKey(val wrappedPrivateKey: String, val wrapIv: String, val kdfSalt: String, val kdfIterations: Int)

    fun wrapPrivateKeyWithPassword(priv: PrivateKey, pub: PublicKey, password: String): WrappedPrivateKey {
        val salt = ByteArray(16).also(random::nextBytes)
        val kek = pbkdf2Sha256(password, salt, DEFAULT_KDF_ITERATIONS)
        val j = publicJwk(pub)
        val jwk = """{"crv":"P-256","d":"${privateD(priv)}","ext":true,"key_ops":["deriveBits"],"kty":"EC","x":"${j.x}","y":"${j.y}"}"""
        val iv = ByteArray(12).also(random::nextBytes)
        val ct = gcm(Cipher.ENCRYPT_MODE, kek, iv, jwk.toByteArray(Charsets.UTF_8))
        return WrappedPrivateKey(toB64(ct), toB64(iv), toB64(salt), DEFAULT_KDF_ITERATIONS)
    }

    /** Returns the private scalar "d" (base64url) or throws if the password is wrong. */
    fun unwrapPrivateKeyWithPassword(password: String, w: WrappedPrivateKey): PrivateKey {
        val kek = pbkdf2Sha256(password, fromB64(w.kdfSalt), w.kdfIterations)
        val plain = String(gcm(Cipher.DECRYPT_MODE, kek, fromB64(w.wrapIv), fromB64(w.wrappedPrivateKey)), Charsets.UTF_8)
        val d = jsonString(plain, "d") ?: error("Wrapped key has no private part")
        return privateKeyFromJwk(d)
    }

    // ---------------------------------------------------------------- per-message keys
    private fun gcm(mode: Int, key: ByteArray, iv: ByteArray, data: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return c.doFinal(data)
    }

    private fun hkdfSha256(ikm: ByteArray): ByteArray {
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(HKDF_SALT, "HmacSHA256"))
        val prk = extract.doFinal(ikm)
        val expand = Mac.getInstance("HmacSHA256")
        expand.init(SecretKeySpec(prk, "HmacSHA256"))
        expand.update(HKDF_INFO)
        expand.update(1.toByte())
        return expand.doFinal() // 32 bytes = the single block we need
    }

    private fun sharedKey(mine: PrivateKey, theirs: PublicKey): ByteArray {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(mine)
        ka.doPhase(theirs, true)
        return hkdfSha256(ka.generateSecret())
    }

    fun newMessageKey(): ByteArray = ByteArray(32).also(random::nextBytes)

    data class KeyEnvelope(val user: String, val wrappedKey: String, val keyIv: String)

    fun wrapMessageKey(mk: ByteArray, mine: PrivateKey, recipientPub: PublicKey, userId: String): KeyEnvelope {
        val iv = ByteArray(12).also(random::nextBytes)
        val ct = gcm(Cipher.ENCRYPT_MODE, sharedKey(mine, recipientPub), iv, mk)
        return KeyEnvelope(userId, toB64(ct), toB64(iv))
    }

    fun unwrapMessageKey(wrappedKeyB64: String, keyIvB64: String, mine: PrivateKey, senderPub: PublicKey): ByteArray =
        gcm(Cipher.DECRYPT_MODE, sharedKey(mine, senderPub), fromB64(keyIvB64), fromB64(wrappedKeyB64))

    // ---------------------------------------------------------------- payloads
    data class Sealed(val ciphertextB64: String, val ivB64: String)

    fun encryptText(mk: ByteArray, text: String): Sealed {
        val iv = ByteArray(12).also(random::nextBytes)
        return Sealed(toB64(gcm(Cipher.ENCRYPT_MODE, mk, iv, text.toByteArray(Charsets.UTF_8))), toB64(iv))
    }

    fun decryptText(mk: ByteArray, ciphertextB64: String, ivB64: String): String =
        String(gcm(Cipher.DECRYPT_MODE, mk, fromB64(ivB64), fromB64(ciphertextB64)), Charsets.UTF_8)

    fun encryptBytes(mk: ByteArray, data: ByteArray): Pair<ByteArray, String> {
        val iv = ByteArray(12).also(random::nextBytes)
        return gcm(Cipher.ENCRYPT_MODE, mk, iv, data) to toB64(iv)
    }

    fun decryptBytes(mk: ByteArray, data: ByteArray, ivB64: String): ByteArray =
        gcm(Cipher.DECRYPT_MODE, mk, fromB64(ivB64), data)
}
