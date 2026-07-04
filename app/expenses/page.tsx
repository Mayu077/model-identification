import { getExpenses } from "@/app/actions/expenses"
import { ExpensesClient } from "@/components/expenses/expenses-client"

export const metadata = { title: "Expenses" }

export default async function ExpensesPage() {
  const expenses = await getExpenses()
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Expenses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log truck expenses by typing a message, uploading a payment screenshot, or adding
          manually.
        </p>
      </header>
      <ExpensesClient initialExpenses={expenses} />
    </main>
  )
}
