pipeline {
    agent any

    options {
        timestamps()
    }

    environment {
        PYTHON = 'C:\\Users\\Kush Bharti\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
        VENV = '.jenkins-venv'
        BACKEND = 'backend'
        REQUIREMENTS = 'backend\\requirements.txt'
    }

    stages {

        stage('Environment Check') {
            steps {
                echo 'Checking Jenkins environment...'

                bat '"%PYTHON%" --version'
                bat 'git --version'
            }
        }

        stage('Create Virtual Environment') {
            steps {
                echo 'Creating isolated Python virtual environment...'

                bat 'if exist "%VENV%" rmdir /s /q "%VENV%"'

                bat '"%PYTHON%" -m venv "%VENV%"'

                bat '"%VENV%\\Scripts\\python.exe" --version'
                bat '"%VENV%\\Scripts\\python.exe" -m pip --version'
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing APIxplore dependencies...'

                bat '"%VENV%\\Scripts\\python.exe" -m pip install --upgrade pip'

                bat '"%VENV%\\Scripts\\python.exe" -m pip install -r "%REQUIREMENTS%"'
            }
        }

        stage('Automated Testing') {
            steps {
                echo 'Running APIxplore automated tests...'

                bat '"%VENV%\\Scripts\\python.exe" -m pytest -v backend\\test_simple.py'
            }
        }
    }

    post {
        success {
            echo 'APIxplore CI pipeline completed successfully.'
        }

        failure {
            echo 'APIxplore CI pipeline failed.'
        }

        always {
            echo 'Jenkins pipeline execution completed.'
        }
    }
}