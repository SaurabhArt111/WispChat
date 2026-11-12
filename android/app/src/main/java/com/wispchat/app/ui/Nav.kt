package com.wispchat.app.ui

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.wispchat.app.data.Post
import com.wispchat.app.data.User

/** Every full-screen page that opens on top of the 5 tabs. The most recent one is on top; Back / swipe-right pops it. */
sealed interface Route {
    data class Chat(val id: String, val jumpTo: String? = null) : Route
    data object Settings : Route
    data object Archived : Route
    data object Groups : Route
    data object NewChat : Route
    data object NewGroup : Route
    data object MediaStorage : Route
    data object Broadcast : Route
    data object FriendRequests : Route
    data class Person(val user: User) : Route
    data class ContactInfo(val convId: String) : Route
    data class GroupInfo(val convId: String) : Route
    data class StatusView(val userId: String) : Route
    data object StatusText : Route
    data class StatusMedia(val uri: Uri) : Route
    data object StatusPrivacy : Route
    data class PostView(val posts: List<Post>, val index: Int) : Route
    data object EditProfile : Route
    data class NewPost(val uri: Uri, val editing: Post? = null) : Route
    data object NewCall : Route
}

class Nav {
    val stack = mutableStateListOf<Route>()

    /** Tab to scroll the pager to (set by anything that wants to switch tabs, consumed by the shell). */
    var tabRequest by mutableStateOf<Int?>(null)

    fun push(r: Route) { stack.add(r) }
    fun pop() { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    fun popAll() { stack.clear() }

    /** True on tablets / unfolded foldables: pages open in the right-hand pane next to the tab list. */
    var twoPane = false

    fun openChat(id: String, jumpTo: String? = null) {
        val top = stack.lastOrNull()
        if (top is Route.Chat && top.id == id) return
        // In two-pane mode picking another chat swaps the detail pane instead of piling chats on a stack.
        if (twoPane && top is Route.Chat) stack[stack.lastIndex] = Route.Chat(id, jumpTo) else stack.add(Route.Chat(id, jumpTo))
    }

    /** Replaces the page on top (e.g. New chat → the chat itself, so Back doesn't return to the picker). */
    fun replaceTop(r: Route) { if (stack.isNotEmpty()) stack[stack.lastIndex] = r else stack.add(r) }

    fun goTab(i: Int) { tabRequest = i }
}

const val TAB_CHATS = 0
const val TAB_STATUS = 1
const val TAB_EXPLORE = 2
const val TAB_CALLS = 3
const val TAB_PROFILE = 4
