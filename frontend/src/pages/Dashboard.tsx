export default function Dashboard() {
    return (
        <div className="space-y-6 p-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="bg-card text-card-foreground rounded-lg border shadow-sm p-6">
                    <h3 className="font-semibold leading-none tracking-tight">Total Tests</h3>
                    <div className="mt-2 text-3xl font-bold">128</div>
                </div>
                <div className="bg-card text-card-foreground rounded-lg border shadow-sm p-6">
                    <h3 className="font-semibold leading-none tracking-tight">Passed</h3>
                    <div className="mt-2 text-3xl font-bold text-green-500">112</div>
                </div>
                <div className="bg-card text-card-foreground rounded-lg border shadow-sm p-6">
                    <h3 className="font-semibold leading-none tracking-tight">Failed</h3>
                    <div className="mt-2 text-3xl font-bold text-red-500">8</div>
                </div>
                <div className="bg-card text-card-foreground rounded-lg border shadow-sm p-6">
                    <h3 className="font-semibold leading-none tracking-tight">Pending</h3>
                    <div className="mt-2 text-3xl font-bold text-yellow-500">8</div>
                </div>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 min-h-[400px]">
                <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                <div className="text-muted-foreground">Select a module from the left to view details.</div>
            </div>
        </div>
    )
}
