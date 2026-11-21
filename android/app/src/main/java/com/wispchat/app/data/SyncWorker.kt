package com.wispchat.app.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.wispchat.app.repo
import java.util.concurrent.TimeUnit

/**
 * Background replay of the offline queue (unsent messages + pending actions). Android runs it once the phone
 * has a network again — even if the app was closed — and keeps retrying with back-off while the server is asleep.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val repo = applicationContext.repo
        if (repo.store.token == null || repo.me.value == null) return Result.success()
        repo.syncPending()
        return if (repo.db.countPending() == 0) Result.success() else if (runAttemptCount > 30) Result.failure() else Result.retry()
    }

    companion object {
        private const val NAME = "wisp-pending-sync"

        fun schedule(ctx: Context) {
            try {
                val req = OneTimeWorkRequestBuilder<SyncWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                    .build()
                WorkManager.getInstance(ctx).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, req)
            } catch (_: Exception) { /* WorkManager unavailable: the in-app retry loop still runs */ }
        }

        fun cancel(ctx: Context) { try { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) } catch (_: Exception) {} }
    }
}
