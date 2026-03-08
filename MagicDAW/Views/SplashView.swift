import SwiftUI

struct SplashView: View {
    @State private var opacity: Double = 0.0
    @State private var scale: Double = 0.9
    @State private var dotOpacity: Double = 0.3

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 24) {
                // Logo / Icon area
                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                gradient: Gradient(colors: [
                                    Color(red: 0.4, green: 0.2, blue: 0.8).opacity(0.6),
                                    Color.clear
                                ]),
                                center: .center,
                                startRadius: 20,
                                endRadius: 80
                            )
                        )
                        .frame(width: 160, height: 160)

                    Image(systemName: "waveform.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.6, green: 0.4, blue: 1.0),
                                    Color(red: 0.3, green: 0.7, blue: 1.0)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }

                // Title
                Text("Magic DAW")
                    .font(.system(size: 32, weight: .light, design: .default))
                    .foregroundColor(.white)
                    .tracking(4)

                // Loading indicator
                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(Color(red: 0.5, green: 0.3, blue: 0.9))
                            .frame(width: 6, height: 6)
                            .opacity(dotOpacity)
                            .animation(
                                .easeInOut(duration: 0.6)
                                .repeatForever(autoreverses: true)
                                .delay(Double(index) * 0.2),
                                value: dotOpacity
                            )
                    }
                }
                .padding(.top, 8)
            }
            .scaleEffect(scale)
            .opacity(opacity)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                opacity = 1.0
                scale = 1.0
            }
            dotOpacity = 1.0
        }
    }
}
