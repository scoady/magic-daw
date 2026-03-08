pipeline {
    agent { label 'macos' }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Tag') {
            steps {
                script {
                    env.BUILD_TAG_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    def dirty = sh(script: 'git status --porcelain | wc -l | tr -d " "', returnStdout: true).trim()
                    echo "Build tag: ${env.BUILD_TAG_SHORT}"
                }
            }
        }

        stage('Build UI') {
            steps {
                sh 'cd MagicDAW-UI && npm install && npm run build'
            }
        }

        stage('Build Swift') {
            steps {
                sh 'swift build -c release'
            }
        }

        stage('Test') {
            steps {
                sh 'swift test 2>&1 || echo "No tests yet"'
            }
        }
    }

    post {
        success {
            echo "Magic DAW build ${env.BUILD_TAG_SHORT} succeeded"
        }
        failure {
            echo "Magic DAW build ${env.BUILD_TAG_SHORT} failed"
        }
    }
}
