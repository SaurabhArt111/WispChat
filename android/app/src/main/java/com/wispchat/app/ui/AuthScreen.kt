package com.wispchat.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.wispchat.app.data.ApiException
import com.wispchat.app.repo
import kotlinx.coroutines.launch

@Composable
fun AuthScreen() {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    val notice by repo.authNotice.collectAsState()
    var register by remember { mutableStateOf(false) }
    var identifier by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try {
                if (register) repo.register(username.trim(), name.trim(), email.trim(), password)
                else repo.login(identifier.trim(), password)
            } catch (e: ApiException) { error = e.message } catch (e: Exception) { error = e.message ?: "Something went wrong" }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Logo(112.dp)
        Spacer(Modifier.height(18.dp))
        // Infographic row: one glyph per promise.
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Glyph(Icons.Filled.Send, Mint); Glyph(Icons.Filled.Image, Sky); Glyph(Icons.Filled.Call, Violet)
            Glyph(Icons.Filled.Group, Color(0xFFF5A65B)); Glyph(Icons.Filled.Lock, Mint)
        }
        Spacer(Modifier.height(28.dp))

        notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(bottom = 12.dp)) }

        if (register) {
            Field("Username", username, { username = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '_' || c == '.' } })
            Field("Display name", name, { name = it })
            Field("Email", email, { email = it }, KeyboardType.Email)
        } else {
            Field("Username or email", identifier, { identifier = it }, KeyboardType.Email)
        }
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("Password") }, singleLine = true,
            visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = "Show password") } },
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
        Spacer(Modifier.height(14.dp))
        Button(onClick = ::submit, enabled = !busy && password.length >= 6, modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Color(0xFF04141C))
            else Text(if (register) "Create account" else "Sign in")
        }
        TextButton(onClick = { register = !register; error = null }) { Text(if (register) "I already have an account" else "Create an account") }
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, type: KeyboardType = KeyboardType.Text) =
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = type), modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp))

@Composable
private fun Glyph(icon: ImageVector, tint: Color) =
    androidx.compose.foundation.layout.Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(tint.copy(alpha = 0.14f)), Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
    }
